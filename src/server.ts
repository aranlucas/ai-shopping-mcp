import OAuthProvider from "@cloudflare/workers-oauth-provider";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import dotenv from "dotenv";
import { z } from "zod";
import { KrogerHandler } from "./kroger-handler.js";
import { registerPrompts } from "./prompts.js";
import type { components } from "./services/kroger/cart.js";
import {
  cartClient,
  configureKrogerAuth,
  isKrogerTokenExpiring,
  type KrogerTokenInfo,
  locationClient,
  productClient,
  refreshKrogerToken,
} from "./services/kroger/client.js";
import {
  formatEquipmentListCompact,
  formatLocation,
  formatLocationListCompact,
  formatOrderHistoryCompact,
  formatPantryListCompact,
  formatPreferredLocationCompact,
  formatProductCompact,
  formatProductList,
  formatShoppingListCompact,
  formatShoppingListsCompact,
} from "./utils/format-response.js";
import {
  createUserStorage,
  type EquipmentItem,
  type OrderRecord,
  type PantryItem,
  type PreferredLocation,
  type ShoppingListItem,
} from "./utils/user-storage.js";

// Context from the auth process, encrypted & stored in the auth token
// and provided to the DurableMCP as this.props
type Props = {
  id: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt: number;
  // Kroger credentials stored for token refresh in tokenExchangeCallback
  krogerClientId: string;
  krogerClientSecret: string;
};

// Type aliases for API schemas
type CartItem = components["schemas"]["cart.cartItemModel"];
type CartItemRequest = components["schemas"]["cart.cartItemRequestModel"];

dotenv.config();

export class MyMCP extends McpAgent<Env, unknown, Props> {
  server = new McpServer({
    name: "kroger-ai-assistant",
    version: "1.0.0",
  });

  async init() {
    // Register MCP prompts for guided workflows
    registerPrompts(this.server);

    // Configure Kroger auth for all clients
    configureKrogerAuth((): KrogerTokenInfo | null => {
      // Return current token info from props
      if (!this.props?.accessToken) return null;

      return {
        accessToken: this.props.accessToken,
        refreshToken: this.props.refreshToken,
        tokenExpiresAt: this.props.tokenExpiresAt,
        // Use credentials from props (stored during initial auth)
        krogerClientId: this.props.krogerClientId,
        krogerClientSecret: this.props.krogerClientSecret,
      };
    });

    // Add to cart tool
    this.server.registerTool(
      "add_to_cart",
      {
        description:
          "Adds specified items to a user's shopping cart. Use this tool when the user wants to add products to their cart for purchase. Prefer to use add to cart with multiple items. Location ID will default to user's preferred location if not specified.",
        inputSchema: z.object({
          items: z.array(
            z.object({
              upc: z.string().length(13, {
                message: "UPC must be exactly 13 characters long",
              }),
              quantity: z
                .number()
                .min(1, { message: "Quantity must be at least 1" }),
              modality: z.enum(["DELIVERY", "PICKUP"]).default("PICKUP"),
            }),
          ),
          locationId: z
            .string()
            .length(8, { message: "Location ID must be exactly 8 characters" })
            .optional()
            .describe(
              "Store location ID for the cart. If not provided, uses your preferred location.",
            ),
        }),
      },
      async ({ items, locationId }) => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        // Get location ID from preferred location if not provided
        let effectiveLocationId = locationId;
        let locationName: string | undefined;

        if (!effectiveLocationId) {
          const storage = createUserStorage(this.env.USER_DATA_KV);
          const preferredLocation = await storage.preferredLocation.get(
            this.props.id,
          );

          if (!preferredLocation) {
            throw new Error(
              "No location specified and no preferred location set. Please provide a locationId or set your preferred location using set_preferred_location.",
            );
          }

          effectiveLocationId = preferredLocation.locationId;
          locationName = preferredLocation.locationName;
        }

        // Convert items to the format expected by the Kroger API
        const cartItems: CartItem[] = items.map((item) => ({
          upc: item.upc,
          quantity: item.quantity,
          modality: item.modality,
        }));

        const requestBody: CartItemRequest = {
          items: cartItems,
        };

        // Make the API call to add items to the cart
        const { error } = await cartClient.PUT("/v1/cart/add", {
          body: requestBody,
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (error) {
          console.error("Error adding items to cart:", error);
          throw new Error(
            `Failed to add items to cart: ${JSON.stringify(error)}`,
          );
        }

        console.log(
          `Items successfully added to cart for location ${effectiveLocationId}`,
        );

        // Return a success response with location context
        const locationInfo = locationName
          ? ` at ${locationName}`
          : ` (Location: ${effectiveLocationId})`;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                message: `Successfully added ${items.length} item(s) to cart${locationInfo}`,
                itemsAdded: items.length,
                locationId: effectiveLocationId,
                success: true,
              }),
            },
          ],
        };
      },
    );

    // List items tool can be added here in the future
    // Search locations tool
    this.server.registerTool(
      "search_locations",
      {
        description:
          "Searches for Kroger store locations based on various filter criteria. Use this tool when the user needs to find nearby Kroger stores or specific store locations. Locations can be searched by zip code, latitude/longitude coordinates, radius, chain name, or department availability.",
        inputSchema: z.object({
          zipCodeNear: z
            .string()
            .length(5, { message: "Zip code must be exactly 5 digits" })
            .default("98122"),
          limit: z.number().min(1).max(200).optional().default(1),
          chain: z.string().optional().default("QFC"),
        }),
      },
      async ({ zipCodeNear, limit, chain }) => {
        // Build query parameters
        const queryParams: Record<string, string | number> = {};

        // Add coordinates parameters (must use one of these)
        if (zipCodeNear) {
          queryParams["filter.zipCode.near"] = zipCodeNear;
        }

        if (limit !== undefined) {
          queryParams["filter.limit"] = limit;
        }
        if (chain) {
          queryParams["filter.chain"] = chain;
        }

        console.log("Query parameters for location search:", queryParams);
        // Make the API call to search for locations
        const { data, error } = await locationClient.GET("/v1/locations", {
          params: {
            query: queryParams,
          },
        });

        if (error) {
          console.error("Error searching locations:", error);
          throw new Error(
            `Failed to search locations: ${JSON.stringify(error)}`,
          );
        }

        // Format the response for display
        const locations = data?.data || [];
        console.log(`Found ${locations.length} locations`);

        // Return a successful response with compact formatting
        const formattedLocations = formatLocationListCompact(locations);

        return {
          content: [
            {
              type: "text",
              text: `Found ${locations.length} location(s):\n${formattedLocations}`,
            },
          ],
        };
      },
    );

    // Get location details tool
    this.server.registerTool(
      "get_location_details",
      {
        description:
          "Retrieves detailed information about a specific Kroger store location using its location ID. Use this tool when the user needs comprehensive information about a particular store, including address, hours, departments, and geolocation.",
        inputSchema: z.object({
          locationId: z.string().length(8, {
            message: "Location ID must be exactly 8 characters long",
          }),
        }),
      },
      async ({ locationId }) => {
        // Make the API call to get location details
        const { data, error } = await locationClient.GET(
          "/v1/locations/{locationId}",
          {
            params: { path: { locationId } },
          },
        );

        if (error) {
          console.error("Error getting location details:", error);
          throw new Error(
            `Failed to get location details: ${JSON.stringify(error)}`,
          );
        }

        const location = data?.data;
        if (!location) {
          throw new Error(
            `No information found for location ID: ${locationId}`,
          );
        }

        console.log(`Retrieved details for location: ${location.name}`);

        // Return successful response with formatted text
        const formattedLocation = formatLocation(location);

        return {
          content: [
            {
              type: "text",
              text: `Location Details:\n\n${formattedLocation}`,
            },
          ],
        };
      },
    );
    // Search products tool - bulk search with limit of 10 items per term
    this.server.registerTool(
      "search_products",
      {
        description:
          "Searches for Kroger products in bulk using multiple search terms. Use this tool when the user wants to find multiple products at once. Each search term returns up to 10 items. Provides essential product details including pricing and availability.",
        inputSchema: z.object({
          terms: z
            .array(z.string().max(100))
            .min(1, { message: "At least one search term is required" })
            .max(10, { message: "Maximum 10 search terms allowed" })
            .describe(
              "Array of search terms for products (e.g., ['milk', 'bread', 'eggs'])",
            ),
          locationId: z
            .string()
            .length(8, { message: "Location ID must be exactly 8 characters" })
            .describe(
              "Location ID to check product availability at a specific store",
            ),
        }),
      },
      async ({ terms, locationId }, extra) => {
        // Limit of 10 items per search term
        const ITEMS_PER_TERM = 10;

        // Progress tracking
        let completedSearches = 0;
        const totalSearches = terms.length;
        const progressToken = extra?._meta?.progressToken;

        // Execute all searches in parallel with progress tracking
        const searchPromises = terms.map(async (term) => {
          // Build query parameters
          const queryParams: Record<string, string | number> = {
            "filter.term": term,
            "filter.locationId": locationId,
            "filter.fulfillment": "ais",
            "filter.limit": ITEMS_PER_TERM,
          };

          // Make the API call to search for products
          const { data, error } = await productClient.GET("/v1/products", {
            params: {
              query: queryParams,
            },
          });

          if (error) {
            console.error(
              `Error searching products for term "${term}":`,
              error,
            );
            return { term, products: [], count: 0 };
          }

          const products = data?.data || [];
          console.log(`Found ${products.length} products for term "${term}"`);

          // Send progress notification after each search completes
          completedSearches++;
          if (progressToken && extra?.sendNotification) {
            try {
              await extra.sendNotification({
                method: "notifications/progress",
                params: {
                  progressToken,
                  progress: completedSearches,
                  total: totalSearches,
                },
              });
            } catch (error) {
              console.error("Failed to send progress notification:", error);
            }
          }

          return { term, products, count: products.length };
        });

        // Wait for all searches to complete
        const results = await Promise.all(searchPromises);

        // Count total products
        const totalProducts = results.reduce((sum, r) => sum + r.count, 0);

        if (totalProducts === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No products found matching your search terms.",
              },
            ],
          };
        }

        // Format results grouped by search term
        const formattedSections = results.map((result) => {
          if (result.count === 0) {
            return `**${result.term}** (0 items)\nNo products found.`;
          }

          // Sort products within each term: pickup in-stock first, then delivery-only, then out-of-stock last
          result.products.sort((a, b) => {
            const aItem = a.items?.[0];
            const bItem = b.items?.[0];
            const aPickup =
              aItem?.fulfillment?.curbside || aItem?.fulfillment?.instore;
            const bPickup =
              bItem?.fulfillment?.curbside || bItem?.fulfillment?.instore;

            // Pickup available items come first
            if (aPickup && !bPickup) return -1;
            if (!aPickup && bPickup) return 1;
            return 0;
          });

          // Format products for this term
          const productsFormatted = result.products
            .map(
              (product, index) =>
                `  ${index + 1}. ${formatProductCompact(product)}`,
            )
            .join("\n");

          return `**${result.term}** (${result.count} items)\n${productsFormatted}`;
        });

        return {
          content: [
            {
              type: "text",
              text: `Bulk search completed (${terms.length} search terms, ${totalProducts} total products):\n\n${formattedSections.join("\n\n")}`,
            },
          ],
        };
      },
    );

    // Get product details tool
    this.server.registerTool(
      "get_product_details",
      {
        description:
          "Retrieves detailed information about a specific Kroger product using its product ID. Use this tool when the user needs comprehensive details about a particular product, including pricing, availability, nutritional information, and images.",
        inputSchema: z.object({
          productId: z.string().length(13, {
            message: "Product ID must be a 13-digit UPC number",
          }),
          locationId: z
            .string()
            .length(8, { message: "Location ID must be exactly 8 characters" })
            .optional()
            .describe(
              "Location ID to check product availability and pricing at a specific store",
            ),
        }),
      },
      async ({ productId, locationId }) => {
        // Build query parameters
        const queryParams: Record<string, string> = {};

        if (locationId) {
          queryParams["filter.locationId"] = locationId;
        }

        // Make the API call to get product details
        const { data, error } = await productClient.GET("/v1/products/{id}", {
          params: {
            path: { id: productId },
            query: queryParams,
          },
        });

        if (error) {
          console.error("Error getting product details:", error);
          throw new Error(
            `Failed to get product details: ${JSON.stringify(error)}`,
          );
        }

        const product = data.data;
        if (!product) {
          throw new Error(`No information found for product ID: ${productId}`);
        }

        console.log(`Retrieved details for product: ${product.description}`);

        // Return successful response with formatted product
        const formattedProduct = formatProductList([product]);

        return {
          content: [
            {
              type: "text",
              text: `Product Details:\n\n${formattedProduct}`,
            },
          ],
        };
      },
    );

    // Set preferred location tool
    this.server.registerTool(
      "set_preferred_location",
      {
        description:
          "Sets the user's preferred store location for future shopping. Use this when the user wants to save their favorite store. This makes it easier to search products and check deals without specifying location each time.",
        inputSchema: z.object({
          locationId: z
            .string()
            .length(8, { message: "Location ID must be exactly 8 characters" }),
        }),
      },
      async ({ locationId }) => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        // Get location details to store complete information
        const { data, error } = await locationClient.GET(
          "/v1/locations/{locationId}",
          {
            params: { path: { locationId } },
          },
        );

        if (error || !data?.data) {
          throw new Error(
            `Failed to get location details: ${JSON.stringify(error)}`,
          );
        }

        const location = data.data;
        const storage = createUserStorage(this.env.USER_DATA_KV);

        const preferredLocation: PreferredLocation = {
          locationId: location.locationId || "",
          locationName: location.name || "",
          address:
            `${location.address?.addressLine1 || ""}, ${location.address?.city || ""}, ${location.address?.state || ""} ${location.address?.zipCode || ""}`.trim(),
          chain: location.chain || "",
          setAt: new Date().toISOString(),
        };

        await storage.preferredLocation.set(this.props.id, preferredLocation);

        const formatted = formatPreferredLocationCompact(preferredLocation);

        return {
          content: [
            {
              type: "text",
              text: `Preferred location set successfully:\n\n${formatted}`,
            },
          ],
        };
      },
    );

    // Get preferred location tool
    this.server.registerTool(
      "get_preferred_location",
      {
        description:
          "Retrieves the user's saved preferred store location. Use this to check which store the user has set as their default for shopping.",
        inputSchema: z.object({}),
      },
      async () => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);
        const location = await storage.preferredLocation.get(this.props.id);

        if (!location) {
          return {
            content: [
              {
                type: "text",
                text: "No preferred location set. Use set_preferred_location to save your favorite store.",
              },
            ],
          };
        }

        const formatted = formatPreferredLocationCompact(location);

        return {
          content: [
            {
              type: "text",
              text: `Your preferred location:\n\n${formatted}`,
            },
          ],
        };
      },
    );

    // Add to pantry tool
    this.server.registerTool(
      "add_to_pantry",
      {
        description:
          "Adds items to your personal pantry inventory. Use this to track what groceries you already have at home. Helps avoid buying duplicates and manage inventory.",
        inputSchema: z.object({
          items: z.array(
            z.object({
              productId: z
                .string()
                .length(13, { message: "Product ID must be 13 digits" }),
              productName: z.string(),
              quantity: z.number().min(1),
              expiresAt: z.string().optional(),
            }),
          ),
        }),
      },
      async ({ items }) => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);
        const now = new Date().toISOString();

        for (const item of items) {
          const pantryItem: PantryItem = {
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantity,
            addedAt: now,
            expiresAt: item.expiresAt,
          };

          await storage.pantry.add(this.props.id, pantryItem);
        }

        const pantry = await storage.pantry.getAll(this.props.id);
        const formatted = formatPantryListCompact(pantry);

        return {
          content: [
            {
              type: "text",
              text: `Added ${items.length} item(s) to pantry.\n\nYour pantry:\n\n${formatted}`,
            },
          ],
        };
      },
    );

    // Remove from pantry tool
    this.server.registerTool(
      "remove_from_pantry",
      {
        description:
          "Removes an item from your pantry inventory. Use this when you've used up an item or want to remove it from tracking.",
        inputSchema: z.object({
          productId: z
            .string()
            .length(13, { message: "Product ID must be 13 digits" }),
        }),
      },
      async ({ productId }) => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);
        await storage.pantry.remove(this.props.id, productId);

        const pantry = await storage.pantry.getAll(this.props.id);
        const formatted = formatPantryListCompact(pantry);

        return {
          content: [
            {
              type: "text",
              text: `Item removed from pantry.\n\nYour pantry:\n\n${formatted}`,
            },
          ],
        };
      },
    );

    // View pantry tool
    this.server.registerTool(
      "view_pantry",
      {
        description:
          "Displays all items currently in your pantry inventory. Use this to see what groceries you have at home before shopping.",
        inputSchema: z.object({}),
      },
      async () => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);
        const pantry = await storage.pantry.getAll(this.props.id);
        const formatted = formatPantryListCompact(pantry);

        return {
          content: [
            {
              type: "text",
              text: `Your pantry (${pantry.length} items):\n\n${formatted}`,
            },
          ],
        };
      },
    );

    // Clear pantry tool
    this.server.registerTool(
      "clear_pantry",
      {
        description:
          "Removes all items from your pantry inventory. Use this to start fresh with pantry tracking.",
        inputSchema: z.object({}),
      },
      async () => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);
        await storage.pantry.clear(this.props.id);

        return {
          content: [
            {
              type: "text",
              text: "Pantry cleared successfully.",
            },
          ],
        };
      },
    );

    // Add to equipment tool
    this.server.registerTool(
      "add_to_equipment",
      {
        description:
          "Adds kitchen equipment or tools to your personal equipment inventory. Use this to track what cooking equipment you own. Helps with recipe planning and knowing what tools you have available.",
        inputSchema: z.object({
          items: z.array(
            z.object({
              equipmentName: z.string().min(1),
              category: z
                .string()
                .optional()
                .describe(
                  "Optional category (e.g., 'Baking', 'Cooking', 'Utensils', 'Appliances')",
                ),
            }),
          ),
        }),
      },
      async ({ items }) => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);
        const now = new Date().toISOString();

        for (const item of items) {
          const equipmentItem: EquipmentItem = {
            equipmentName: item.equipmentName,
            category: item.category,
            addedAt: now,
          };

          await storage.equipment.add(this.props.id, equipmentItem);
        }

        const equipment = await storage.equipment.getAll(this.props.id);
        const formatted = formatEquipmentListCompact(equipment);

        return {
          content: [
            {
              type: "text",
              text: `Added ${items.length} item(s) to equipment.\n\nYour equipment:\n\n${formatted}`,
            },
          ],
        };
      },
    );

    // Remove from equipment tool
    this.server.registerTool(
      "remove_from_equipment",
      {
        description:
          "Removes an item from your equipment inventory. Use this when you no longer have a piece of equipment or want to remove it from tracking.",
        inputSchema: z.object({
          equipmentName: z
            .string()
            .min(1)
            .describe("Name of equipment to remove"),
        }),
      },
      async ({ equipmentName }) => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);
        await storage.equipment.remove(this.props.id, equipmentName);

        const equipment = await storage.equipment.getAll(this.props.id);
        const formatted = formatEquipmentListCompact(equipment);

        return {
          content: [
            {
              type: "text",
              text: `Item removed from equipment.\n\nYour equipment:\n\n${formatted}`,
            },
          ],
        };
      },
    );

    // View equipment tool
    this.server.registerTool(
      "view_equipment",
      {
        description:
          "Displays all kitchen equipment and tools in your inventory. Use this to see what cooking equipment you have available before planning recipes.",
        inputSchema: z.object({}),
      },
      async () => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);
        const equipment = await storage.equipment.getAll(this.props.id);
        const formatted = formatEquipmentListCompact(equipment);

        return {
          content: [
            {
              type: "text",
              text: `Your equipment (${equipment.length} items):\n\n${formatted}`,
            },
          ],
        };
      },
    );

    // Clear equipment tool
    this.server.registerTool(
      "clear_equipment",
      {
        description:
          "Removes all items from your equipment inventory. Use this to start fresh with equipment tracking.",
        inputSchema: z.object({}),
      },
      async () => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);
        await storage.equipment.clear(this.props.id);

        return {
          content: [
            {
              type: "text",
              text: "Equipment cleared successfully.",
            },
          ],
        };
      },
    );

    // Mark order placed tool
    this.server.registerTool(
      "mark_order_placed",
      {
        description:
          "Records a completed order in your order history. Use this after successfully placing an order to track your purchases over time.",
        inputSchema: z.object({
          items: z.array(
            z.object({
              productId: z.string(),
              productName: z.string(),
              quantity: z.number().min(1),
              price: z.number().optional(),
            }),
          ),
          locationId: z.string().optional(),
          notes: z.string().optional(),
        }),
      },
      async ({ items, locationId, notes }) => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);

        // Generate order ID with timestamp
        const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
        const estimatedTotal = items.reduce((sum, item) => {
          return sum + (item.price || 0) * item.quantity;
        }, 0);

        const order: OrderRecord = {
          orderId,
          items,
          totalItems,
          estimatedTotal: estimatedTotal > 0 ? estimatedTotal : undefined,
          placedAt: new Date().toISOString(),
          locationId,
          notes,
        };

        await storage.orderHistory.add(this.props.id, order);

        const formatted = formatOrderHistoryCompact([order]);

        return {
          content: [
            {
              type: "text",
              text: `Order recorded successfully:\n\n${formatted}`,
            },
          ],
        };
      },
    );

    // View order history tool
    this.server.registerTool(
      "view_order_history",
      {
        description:
          "Displays your past order history. Use this to see previous purchases and track shopping patterns. Returns most recent orders first.",
        inputSchema: z.object({
          limit: z
            .number()
            .min(1)
            .max(50)
            .optional()
            .default(10)
            .describe("Number of recent orders to display"),
        }),
      },
      async ({ limit }) => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);
        const orders = await storage.orderHistory.getRecent(
          this.props.id,
          limit,
        );

        const formatted = formatOrderHistoryCompact(orders);

        return {
          content: [
            {
              type: "text",
              text: `Order History (${orders.length} recent orders):\n\n${formatted}`,
            },
          ],
        };
      },
    );

    // Create shopping list tool
    this.server.registerTool(
      "create_shopping_list",
      {
        description:
          "Creates a new named shopping list. Use this to organize items into different lists (e.g., 'Weekly Groceries', 'Party Supplies'). Lists can be managed separately and added to cart when ready.",
        inputSchema: z.object({
          listName: z.string().min(1).max(100).describe("Name of the list"),
          items: z
            .array(
              z.object({
                productId: z
                  .string()
                  .length(13, { message: "Product ID must be 13 digits" })
                  .optional(),
                productName: z.string(),
                quantity: z.number().min(1),
                notes: z.string().optional(),
              }),
            )
            .optional()
            .default([])
            .describe("Optional initial items to add to the list"),
        }),
      },
      async ({ listName, items }) => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);
        const now = new Date().toISOString();

        const shoppingListItems: ShoppingListItem[] = items.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          notes: item.notes,
          addedAt: now,
        }));

        const list = await storage.shoppingLists.create(
          this.props.id,
          listName,
          shoppingListItems,
        );

        const formatted = formatShoppingListCompact(list);

        return {
          content: [
            {
              type: "text",
              text: `Shopping list "${listName}" created successfully.\n\n${formatted}`,
            },
          ],
        };
      },
    );

    // Add items to shopping list tool
    this.server.registerTool(
      "add_items_to_shopping_list",
      {
        description:
          "Adds items to an existing shopping list. Use this to add products to a named list for later purchase.",
        inputSchema: z.object({
          listName: z.string().min(1).describe("Name of the list"),
          items: z.array(
            z.object({
              productId: z
                .string()
                .length(13, { message: "Product ID must be 13 digits" })
                .optional(),
              productName: z.string(),
              quantity: z.number().min(1),
              notes: z.string().optional(),
            }),
          ),
        }),
      },
      async ({ listName, items }) => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);
        const now = new Date().toISOString();

        const shoppingListItems: ShoppingListItem[] = items.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          notes: item.notes,
          addedAt: now,
        }));

        const list = await storage.shoppingLists.addItems(
          this.props.id,
          listName,
          shoppingListItems,
        );

        const formatted = formatShoppingListCompact(list);

        return {
          content: [
            {
              type: "text",
              text: `Added ${items.length} item(s) to "${listName}".\n\n${formatted}`,
            },
          ],
        };
      },
    );

    // Remove items from shopping list tool
    this.server.registerTool(
      "remove_items_from_shopping_list",
      {
        description:
          "Removes items from a shopping list by product ID. Use this to clean up lists or remove items you no longer need.",
        inputSchema: z.object({
          listName: z.string().min(1).describe("Name of the list"),
          productIds: z
            .array(
              z
                .string()
                .length(13, { message: "Product ID must be 13 digits" }),
            )
            .describe("Array of product IDs to remove"),
        }),
      },
      async ({ listName, productIds }) => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);
        const list = await storage.shoppingLists.removeItems(
          this.props.id,
          listName,
          productIds,
        );

        const formatted = formatShoppingListCompact(list);

        return {
          content: [
            {
              type: "text",
              text: `Removed ${productIds.length} item(s) from "${listName}".\n\n${formatted}`,
            },
          ],
        };
      },
    );

    // View shopping list tool
    this.server.registerTool(
      "view_shopping_list",
      {
        description:
          "Displays all items in a specific shopping list. Use this to see what's in a particular list.",
        inputSchema: z.object({
          listName: z.string().min(1).describe("Name of the list to view"),
        }),
      },
      async ({ listName }) => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);
        const list = await storage.shoppingLists.get(this.props.id, listName);

        if (!list) {
          throw new Error(`Shopping list "${listName}" not found`);
        }

        const formatted = formatShoppingListCompact(list);

        return {
          content: [
            {
              type: "text",
              text: formatted,
            },
          ],
        };
      },
    );

    // View all shopping lists tool
    this.server.registerTool(
      "view_all_shopping_lists",
      {
        description:
          "Displays all your shopping lists with item counts. Use this to see what lists you have created.",
        inputSchema: z.object({}),
      },
      async () => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);
        const lists = await storage.shoppingLists.getAll(this.props.id);

        const formatted = formatShoppingListsCompact(lists);

        return {
          content: [
            {
              type: "text",
              text: `Your shopping lists (${lists.length}):\n\n${formatted}`,
            },
          ],
        };
      },
    );

    // Delete shopping list tool
    this.server.registerTool(
      "delete_shopping_list",
      {
        description:
          "Deletes a shopping list permanently. Use this to remove lists you no longer need.",
        inputSchema: z.object({
          listName: z.string().min(1).describe("Name of the list to delete"),
        }),
      },
      async ({ listName }) => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);
        await storage.shoppingLists.delete(this.props.id, listName);

        const lists = await storage.shoppingLists.getAll(this.props.id);
        const formatted = formatShoppingListsCompact(lists);

        return {
          content: [
            {
              type: "text",
              text: `Shopping list "${listName}" deleted.\n\nRemaining lists:\n${formatted}`,
            },
          ],
        };
      },
    );

    // Clear shopping list tool
    this.server.registerTool(
      "clear_shopping_list",
      {
        description:
          "Removes all items from a shopping list while keeping the list itself. Use this to empty a list without deleting it.",
        inputSchema: z.object({
          listName: z.string().min(1).describe("Name of the list to clear"),
        }),
      },
      async ({ listName }) => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);
        const list = await storage.shoppingLists.clearList(
          this.props.id,
          listName,
        );

        const formatted = formatShoppingListCompact(list);

        return {
          content: [
            {
              type: "text",
              text: `Shopping list "${listName}" cleared.\n\n${formatted}`,
            },
          ],
        };
      },
    );

    // Add shopping list to cart tool
    this.server.registerTool(
      "add_shopping_list_to_cart",
      {
        description:
          "Adds all items from a shopping list to your Kroger cart. This is the key feature - converts your planned list into actual cart items. Only adds items that have a product ID (UPC). Location ID defaults to preferred location if not specified.",
        inputSchema: z.object({
          listName: z
            .string()
            .min(1)
            .describe("Name of the shopping list to add to cart"),
          locationId: z
            .string()
            .length(8, { message: "Location ID must be 8 characters" })
            .optional()
            .describe(
              "Location ID for the store (defaults to preferred location)",
            ),
          modality: z
            .enum(["DELIVERY", "PICKUP"])
            .default("PICKUP")
            .describe("Fulfillment method for all items"),
          clearListAfter: z
            .boolean()
            .default(false)
            .describe(
              "Clear the shopping list after adding to cart (default: false)",
            ),
        }),
      },
      async ({ listName, locationId, modality, clearListAfter }) => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);

        // Get the shopping list
        const list = await storage.shoppingLists.get(this.props.id, listName);
        if (!list) {
          throw new Error(`Shopping list "${listName}" not found`);
        }

        // Get location (use preferred if not provided)
        let finalLocationId = locationId;
        if (!finalLocationId) {
          const preferredLocation = await storage.preferredLocation.get(
            this.props.id,
          );
          if (!preferredLocation) {
            throw new Error(
              "No location specified and no preferred location set. Please provide a location ID or set a preferred location first.",
            );
          }
          finalLocationId = preferredLocation.locationId;
        }

        // Filter items that have product IDs
        const itemsWithUpc = list.items.filter((item) => item.productId);

        if (itemsWithUpc.length === 0) {
          throw new Error(
            `No items in "${listName}" have product IDs. Add product IDs to items before adding to cart.`,
          );
        }

        // Build cart items
        const cartItems: CartItem[] = itemsWithUpc.map((item) => ({
          upc: item.productId as string, // We filtered for productId above
          quantity: item.quantity,
          modality: modality,
        }));

        const requestBody: CartItemRequest = {
          items: cartItems,
        };

        // Add to cart using Kroger API
        const { data, error } = await cartClient.PUT("/v1/cart/add", {
          body: requestBody,
        });

        if (error) {
          console.error("Error adding list to cart:", error);
          throw new Error(`Failed to add list to cart: ${JSON.stringify(error)}`);
        }

        // Optionally clear the list after adding to cart
        if (clearListAfter) {
          await storage.shoppingLists.clearList(this.props.id, listName);
        }

        const addedCount = itemsWithUpc.length;
        const skippedCount = list.items.length - itemsWithUpc.length;

        let message = `Added ${addedCount} item(s) from "${listName}" to cart at location ${finalLocationId}.`;

        if (skippedCount > 0) {
          message += `\n\nSkipped ${skippedCount} item(s) without product IDs.`;
        }

        if (clearListAfter) {
          message += `\n\nList "${listName}" has been cleared.`;
        }

        return {
          content: [
            {
              type: "text",
              text: message,
            },
          ],
        };
      },
    );

    // Search recipes from Janella's Cookbook API
    this.server.registerTool(
      "search_recipes_from_web",
      {
        description:
          "Searches for recipes from Janella's Cookbook website using their API. Returns detailed recipe information including ingredients and instructions.",
        inputSchema: z.object({
          searchQuery: z
            .string()
            .min(1)
            .describe(
              "Recipe search query (e.g., 'Cookie', 'Pasta', 'Chicken')",
            ),
        }),
      },
      async ({ searchQuery }) => {
        try {
          // Use the Janella's Cookbook API endpoint
          const apiUrl = "https://janella-cookbook.vercel.app/api/search";
          console.log(`Searching recipes via API: ${searchQuery}`);

          const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ query: searchQuery }),
          });

          if (!response.ok) {
            throw new Error(
              `API request failed: ${response.status} ${response.statusText}`,
            );
          }

          const apiResponse = (await response.json()) as {
            success: boolean;
            data?: {
              results: Array<{
                recipe: {
                  title: string;
                  description?: string;
                  prepTime?: number;
                  cookTime?: number;
                  totalTime?: number;
                  servings?: string;
                  difficulty?: string;
                  cuisine?: string;
                  slug: string;
                  ingredients?: Array<{
                    quantity?: string;
                    unit?: string;
                    name: string;
                    notes?: string;
                  }>;
                  instructions?: Array<{
                    stepNumber: number;
                    instruction: string;
                  }>;
                };
              }>;
            };
            error?: {
              message: string;
            };
          };

          if (!apiResponse.success || !apiResponse.data?.results) {
            throw new Error(
              apiResponse.error?.message || "No results returned from API",
            );
          }

          const recipes = apiResponse.data.results;

          if (recipes.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `No recipes found for "${searchQuery}". Try a different search term.`,
                },
              ],
            };
          }

          // Format recipes for display
          const formattedRecipes = recipes
            .map((result, idx) => {
              const recipe = result.recipe;
              const parts = [`**${idx + 1}. ${recipe.title}**`];

              if (recipe.description) {
                parts.push(recipe.description);
              }

              // Metadata line
              const metadata = [];
              if (recipe.cuisine) metadata.push(recipe.cuisine);
              if (recipe.difficulty)
                metadata.push(recipe.difficulty.toLowerCase());
              if (recipe.totalTime)
                metadata.push(`${recipe.totalTime}min total`);
              else if (recipe.cookTime)
                metadata.push(`${recipe.cookTime}min cook`);
              if (recipe.servings) metadata.push(recipe.servings);
              if (metadata.length > 0) {
                parts.push(`*${metadata.join(" • ")}*`);
              }

              // Ingredients
              if (recipe.ingredients && recipe.ingredients.length > 0) {
                parts.push("\n**Ingredients:**");
                recipe.ingredients.forEach((ing) => {
                  const amount = [ing.quantity, ing.unit]
                    .filter(Boolean)
                    .join(" ");
                  const notes = ing.notes ? ` (${ing.notes})` : "";
                  parts.push(`- ${amount} ${ing.name}${notes}`.trim());
                });
              }

              // Instructions
              if (recipe.instructions && recipe.instructions.length > 0) {
                parts.push("\n**Instructions:**");
                recipe.instructions.forEach((step) => {
                  parts.push(`${step.stepNumber}. ${step.instruction}`);
                });
              }

              // Recipe URL
              parts.push(
                `\n*View online: https://janella-cookbook.vercel.app/recipe/${recipe.slug}*`,
              );

              return parts.join("\n");
            })
            .join("\n\n---\n\n");

          return {
            content: [
              {
                type: "text",
                text: `**Recipe Search Results for "${searchQuery}"**\n\nFound ${recipes.length} recipe(s):\n\n${formattedRecipes}`,
              },
            ],
          };
        } catch (error) {
          console.error("Error fetching recipes:", error);
          return {
            content: [
              {
                type: "text",
                text: `Failed to fetch recipes: ${error instanceof Error ? error.message : "Unknown error"}`,
              },
            ],
          };
        }
      },
    );

    // Register MCP Resources for context data
    // Resource: User's pantry inventory
    this.server.registerResource(
      "Pantry Inventory",
      "shopping://user/pantry",
      {
        description:
          "Items currently in the user's pantry. Use this to avoid suggesting duplicate purchases and to help with meal planning based on available ingredients.",
        mimeType: "application/json",
      },
      async () => {
        if (!this.props?.id) {
          return {
            contents: [
              {
                type: "text",
                uri: "shopping://user/pantry",
                text: JSON.stringify({ error: "User not authenticated" }),
              },
            ],
          };
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);
        const pantry = await storage.pantry.getAll(this.props.id);

        return {
          contents: [
            {
              type: "text",
              uri: "shopping://user/pantry",
              text: JSON.stringify(
                {
                  itemCount: pantry.length,
                  items: pantry,
                  lastUpdated: new Date().toISOString(),
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    // Resource: User's equipment inventory
    this.server.registerResource(
      "Equipment Inventory",
      "shopping://user/equipment",
      {
        description:
          "Kitchen equipment and tools the user owns. Use this to suggest recipes that match available equipment and to help with meal planning based on what tools are available.",
        mimeType: "application/json",
      },
      async () => {
        if (!this.props?.id) {
          return {
            contents: [
              {
                type: "text",
                uri: "shopping://user/equipment",
                text: JSON.stringify({ error: "User not authenticated" }),
              },
            ],
          };
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);
        const equipment = await storage.equipment.getAll(this.props.id);

        return {
          contents: [
            {
              type: "text",
              uri: "shopping://user/equipment",
              text: JSON.stringify(
                {
                  itemCount: equipment.length,
                  items: equipment,
                  lastUpdated: new Date().toISOString(),
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    // Resource: User's preferred store location
    this.server.registerResource(
      "Preferred Store Location",
      "shopping://user/location",
      {
        description:
          "The user's preferred shopping location. Use this for product searches and availability checks when no location is explicitly specified.",
        mimeType: "application/json",
      },
      async () => {
        if (!this.props?.id) {
          return {
            contents: [
              {
                type: "text",
                uri: "shopping://user/location",
                text: JSON.stringify({ error: "User not authenticated" }),
              },
            ],
          };
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);
        const location = await storage.preferredLocation.get(this.props.id);

        if (!location) {
          return {
            contents: [
              {
                type: "text",
                uri: "shopping://user/location",
                text: JSON.stringify({
                  message: "No preferred location set",
                }),
              },
            ],
          };
        }

        return {
          contents: [
            {
              type: "text",
              uri: "shopping://user/location",
              text: JSON.stringify(location, null, 2),
            },
          ],
        };
      },
    );

    // Resource: User's order history
    this.server.registerResource(
      "Order History",
      "shopping://user/orders",
      {
        description:
          "The user's past orders and purchase history. Use this to identify frequently purchased items, shopping patterns, and to make personalized recommendations.",
        mimeType: "application/json",
      },
      async () => {
        if (!this.props?.id) {
          return {
            contents: [
              {
                type: "text",
                uri: "shopping://user/orders",
                text: JSON.stringify({ error: "User not authenticated" }),
              },
            ],
          };
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);
        const orders = await storage.orderHistory.getRecent(this.props.id, 20);

        return {
          contents: [
            {
              type: "text",
              uri: "shopping://user/orders",
              text: JSON.stringify(
                {
                  orderCount: orders.length,
                  orders: orders,
                  lastUpdated: new Date().toISOString(),
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    // Resource template: Product details by ID
    this.server.registerResource(
      "Product Details",
      new ResourceTemplate("shopping://product/{productId}", {
        list: undefined, // No enumeration of all products
      }),
      {
        description:
          "Detailed information about a specific product by its ID (13-digit UPC). Includes pricing, availability, and location information.",
        mimeType: "application/json",
      },
      async (uri: URL) => {
        // Extract productId from URI
        const match = uri.href.match(/shopping:\/\/product\/([0-9]{13})/);
        if (!match) {
          return {
            contents: [
              {
                type: "text",
                uri: uri.href,
                text: JSON.stringify({
                  error:
                    "Invalid product URI format. Expected: shopping://product/{13-digit-upc}",
                }),
              },
            ],
          };
        }

        const productId = match[1];

        // Get preferred location for availability check
        let locationId: string | undefined;
        if (this.props?.id) {
          const storage = createUserStorage(this.env.USER_DATA_KV);
          const location = await storage.preferredLocation.get(this.props.id);
          locationId = location?.locationId;
        }

        // Build query parameters
        const queryParams: Record<string, string> = {};
        if (locationId) {
          queryParams["filter.locationId"] = locationId;
        }

        // Fetch product details
        const { data, error } = await productClient.GET("/v1/products/{id}", {
          params: {
            path: { id: productId },
            query: queryParams,
          },
        });

        if (error) {
          return {
            contents: [
              {
                type: "text",
                uri: uri.href,
                text: JSON.stringify({
                  error: `Failed to fetch product: ${JSON.stringify(error)}`,
                }),
              },
            ],
          };
        }

        const product = data.data;
        if (!product) {
          return {
            contents: [
              {
                type: "text",
                uri: uri.href,
                text: JSON.stringify({
                  error: `No product found with ID: ${productId}`,
                }),
              },
            ],
          };
        }

        return {
          contents: [
            {
              type: "text",
              uri: uri.href,
              text: JSON.stringify(product, null, 2),
            },
          ],
        };
      },
    );
  }
}

export default new OAuthProvider({
  apiHandlers: {
    "/sse": MyMCP.serveSSE("/sse"), // deprecated SSE protocol - use /mcp instead
    "/mcp": MyMCP.serve("/mcp"), // Streamable-HTTP protocol
  },
  // biome-ignore lint/suspicious/noExplicitAny: needed from docs
  defaultHandler: KrogerHandler as any,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",

  /**
   * Token exchange callback - syncs Kroger tokens during MCP token refresh.
   *
   * CRITICAL: This is the ONLY place where Kroger tokens are refreshed.
   * Kroger uses single-use refresh tokens - once used, they're invalidated.
   * This callback is the only place that can persist the new refresh token
   * to the grant. Middleware does NOT refresh to avoid token conflicts.
   *
   * When the MCP token expires, this callback:
   * 1. Checks if Kroger token is expiring (5-minute buffer)
   * 2. Uses the refresh token to get new access + refresh tokens
   * 3. Saves new tokens to props (persisted in the grant)
   * 4. Matches MCP token TTL to Kroger's for synchronized expiry
   */
  tokenExchangeCallback: async ({ grantType, props }) => {
    // Only handle refresh token grants
    if (grantType !== "refresh_token") {
      console.log(
        `Token exchange callback: ignoring grant type "${grantType}"`,
      );
      return {};
    }

    const typedProps = props as Props;

    // Check if we have a refresh token and credentials
    if (!typedProps?.refreshToken || !typedProps?.tokenExpiresAt) {
      console.warn(
        "Token exchange callback: No Kroger refresh token or expiry available",
        {
          hasRefreshToken: !!typedProps?.refreshToken,
          hasTokenExpiresAt: !!typedProps?.tokenExpiresAt,
        },
      );
      return {};
    }

    if (!typedProps?.krogerClientId || !typedProps?.krogerClientSecret) {
      console.warn(
        "Token exchange callback: No Kroger credentials in props. This should not happen.",
      );
      return {};
    }

    // Check if Kroger token is expiring (with 5-minute buffer)
    const tokenExpiresIn = typedProps.tokenExpiresAt - Date.now();
    if (!isKrogerTokenExpiring(typedProps.tokenExpiresAt)) {
      console.log(
        `Token exchange callback: Kroger token still valid (expires in ${Math.round(tokenExpiresIn / 1000)}s), no refresh needed`,
      );
      return {};
    }

    try {
      console.log(
        `Token exchange callback: Refreshing Kroger token (expires in ${Math.round(tokenExpiresIn / 1000)}s)...`,
      );

      const refreshResult = await refreshKrogerToken(
        typedProps.refreshToken,
        typedProps.krogerClientId,
        typedProps.krogerClientSecret,
      );

      console.log(
        `Token exchange callback: Kroger token refreshed successfully. New token expires in ${refreshResult.expiresIn}s`,
      );

      // CRITICAL: Kroger returns a NEW refresh token that must be saved
      // The old refresh token is now invalid (single-use tokens)
      if (!refreshResult.refreshToken) {
        console.error(
          "Token exchange callback: CRITICAL - Kroger refresh response missing new refresh token. " +
            "Old refresh token is now invalid (single-use). User will need to re-authenticate.",
        );
        // Return empty object - this will cause the next refresh to fail,
        // triggering re-authentication flow
        return {};
      }

      return {
        // Update props with new Kroger tokens
        newProps: {
          ...typedProps,
          accessToken: refreshResult.accessToken,
          // MUST use new refresh token (old one is invalid)
          refreshToken: refreshResult.refreshToken,
          tokenExpiresAt: refreshResult.tokenExpiresAt,
        },
        // Match MCP access token TTL to Kroger's to keep them in sync
        accessTokenTTL: refreshResult.expiresIn,
      };
    } catch (error) {
      console.error(
        "Token exchange callback: Failed to refresh Kroger token:",
        error instanceof Error ? error.message : String(error),
      );
      // Return empty to keep existing props - user will need to re-authenticate
      // if the token can't be refreshed
      return {};
    }
  },
});

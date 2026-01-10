import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import dotenv from "dotenv";
import { z } from "zod";
import { KrogerHandler } from "./kroger-handler.js";
import { registerPrompts } from "./prompts.js";
import type { components } from "./services/kroger/cart.js";
import type { components as ProductComponents } from "./services/kroger/product.js";
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
  formatLocation,
  formatLocationList,
  formatOrderHistory,
  formatPantryList,
  formatPreferredLocation,
  formatProductList,
} from "./utils/format-response.js";
import {
  createUserStorage,
  type OrderRecord,
  type PantryItem,
  type PreferredLocation,
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
          "Adds specified items to a user's shopping cart. Use this tool when the user wants to add products to their cart for purchase. Prefer to use add to cart with multiple items.",
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
        }),
      },
      async ({ items }) => {
        // Convert items to the format expected by the Kroger API
        const cartItems: components["schemas"]["cart.cartItemModel"][] =
          items.map((item) => ({
            upc: item.upc,
            quantity: item.quantity,
            modality: item.modality,
          }));

        const requestBody: components["schemas"]["cart.cartItemRequestModel"] =
          {
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

        console.log("Items successfully added to cart");

        // Return a success response
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                message: `Successfully added ${items.length} item(s) to cart`,
                itemsAdded: items.length,
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

        // Return a successful response with formatted text
        const formattedLocations = formatLocationList(locations);

        return {
          content: [
            {
              type: "text",
              text: `Found ${locations.length} location(s):\n\n${formattedLocations}`,
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

        type ProductItem = ProductComponents["schemas"]["products.productModel"];

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
            console.error(`Error searching products for term "${term}":`, error);
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

        // Flatten all products and create search results summary
        const allProducts: ProductItem[] = [];
        const searchResults: Array<{ term: string; count: number }> = [];

        for (const result of results) {
          allProducts.push(...result.products);
          searchResults.push({ term: result.term, count: result.count });
        }

        // Sort products: pickup in-stock first, then delivery-only, then out-of-stock last
        allProducts.sort((a, b) => {
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

        if (allProducts.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No products found matching your search terms.",
              },
            ],
          };
        }

        // Format the response for display
        const formattedProducts = formatProductList(allProducts);

        // Create summary of search results
        const summary = searchResults
          .map((result) => `  • "${result.term}": ${result.count} items`)
          .join("\n");

        return {
          content: [
            {
              type: "text",
              text: `Bulk search completed (${terms.length} search terms, ${allProducts.length} total products):\n\n${summary}\n\n${formattedProducts}`,
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

        const formatted = formatPreferredLocation(preferredLocation);

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

        const formatted = formatPreferredLocation(location);

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
        const formatted = formatPantryList(pantry);

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
        const formatted = formatPantryList(pantry);

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
        const formatted = formatPantryList(pantry);

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

        const formatted = formatOrderHistory([order]);

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

        const formatted = formatOrderHistory(orders);

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

    // MCP Sampling tool: Suggest recipes from pantry items
    this.server.registerTool(
      "suggest_recipes_from_pantry",
      {
        description:
          "Uses AI to suggest recipes based on items currently in your pantry. This tool analyzes your pantry inventory and generates creative recipe ideas using the items you have available.",
        inputSchema: z.object({
          cuisineType: z
            .string()
            .optional()
            .describe("Optional cuisine preference (e.g., 'Italian', 'Mexican', 'Asian')"),
          maxRecipes: z
            .number()
            .min(1)
            .max(5)
            .optional()
            .default(3)
            .describe("Number of recipe suggestions to generate (1-5)"),
        }),
      },
      async ({ cuisineType, maxRecipes }) => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);
        const pantry = await storage.pantry.getAll(this.props.id);

        if (pantry.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "Your pantry is empty. Add items to your pantry first using the add_to_pantry tool, then try this again!",
              },
            ],
          };
        }

        // Build the prompt for the LLM
        const pantryItems = pantry
          .map((item) => `- ${item.productName} (${item.quantity})`)
          .join("\n");

        const cuisineConstraint = cuisineType
          ? `Focus on ${cuisineType} cuisine. `
          : "";

        const prompt = `Given these pantry items:

${pantryItems}

${cuisineConstraint}Suggest ${maxRecipes} creative recipes I can make using ONLY these ingredients (or common household staples like salt, pepper, oil).

For each recipe, provide:
1. Recipe name
2. Required ingredients from the pantry
3. Brief cooking instructions (3-5 steps)
4. Estimated cooking time

Format each recipe clearly and concisely.`;

        // Use MCP sampling to request AI completion via the underlying server
        const samplingResult = await this.server.server.createMessage({
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: prompt,
              },
            },
          ],
          maxTokens: 1000,
        });

        // Extract the text response from sampling result
        // The content field can be a single item or array
        const content = Array.isArray(samplingResult.content)
          ? samplingResult.content[0]
          : samplingResult.content;
        const recipeText =
          content?.type === "text" ? content.text : "Unable to generate recipes";

        return {
          content: [
            {
              type: "text",
              text: `**Recipe Suggestions Based on Your Pantry**\n\n${recipeText}\n\n---\n*Based on ${pantry.length} items in your pantry*`,
            },
          ],
        };
      },
    );

    // MCP Sampling tool: Smart shopping list categorization
    this.server.registerTool(
      "categorize_shopping_list",
      {
        description:
          "Uses AI to intelligently categorize and organize a shopping list by store department/aisle. Helps plan an efficient path through the store.",
        inputSchema: z.object({
          items: z
            .array(z.string())
            .describe("List of items to categorize (e.g., ['milk', 'bread', 'chicken'])"),
        }),
      },
      async ({ items }) => {
        if (items.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "Please provide at least one item to categorize.",
              },
            ],
          };
        }

        const itemList = items.map((item, idx) => `${idx + 1}. ${item}`).join("\n");

        const prompt = `Organize this shopping list by grocery store department/aisle:

${itemList}

Group items by these common grocery store departments:
- Produce (fruits, vegetables)
- Meat & Seafood
- Dairy & Eggs
- Bakery
- Pantry & Canned Goods
- Frozen Foods
- Beverages
- Snacks & Candy
- Health & Beauty
- Household Items

For each department that has items, list the items under that department.
Provide a suggested shopping route (which departments to visit in order for efficiency).`;

        // Use MCP sampling to request AI completion via the underlying server
        const samplingResult = await this.server.server.createMessage({
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: prompt,
              },
            },
          ],
          maxTokens: 800,
        });

        // Extract the text response from sampling result
        const content = Array.isArray(samplingResult.content)
          ? samplingResult.content[0]
          : samplingResult.content;
        const categorizedText =
          content?.type === "text"
            ? content.text
            : "Unable to categorize shopping list";

        return {
          content: [
            {
              type: "text",
              text: `**Shopping List Organized by Department**\n\n${categorizedText}`,
            },
          ],
        };
      },
    );

    // MCP Sampling tool: Extract weekly deals from QFC webpage
    this.server.registerTool(
      "get_weekly_deals_from_web",
      {
        description:
          "Uses AI to scrape and extract current weekly deals from the QFC website. Returns structured deals data including product names, prices, and savings.",
        inputSchema: z.object({
          zipCode: z
            .string()
            .length(5)
            .optional()
            .default("98122")
            .describe("Zip code for location-specific deals"),
        }),
      },
      async ({ zipCode }) => {
        try {
          // Fetch the QFC weekly deals page
          const dealsUrl = `https://www.qfc.com/savings/weekly-ad?zipcode=${zipCode}`;
          console.log(`Fetching weekly deals from: ${dealsUrl}`);

          const response = await fetch(dealsUrl, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              Accept: "text/html,application/xhtml+xml,application/xml",
            },
          });

          if (!response.ok) {
            throw new Error(
              `Failed to fetch deals page: ${response.status} ${response.statusText}`,
            );
          }

          const html = await response.text();

          // Extract just the body content (remove scripts, styles for cleaner parsing)
          const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
          const bodyContent = bodyMatch ? bodyMatch[1] : html;

          // Remove script and style tags
          const cleanedHtml = bodyContent
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
            .substring(0, 50000); // Limit to 50k chars to stay within token limits

          // Use sampling to have the LLM extract deals
          const prompt = `Parse this QFC weekly deals webpage HTML and extract all product deals.

For each deal, extract:
- Product name/description
- Original price (if available)
- Sale price
- Savings amount or percentage
- Any special conditions (e.g., "with card", "limit 5")
- Department/category

Return the results as a structured JSON array. Example format:
[
  {
    "product": "Product name",
    "originalPrice": "$9.99",
    "salePrice": "$6.99",
    "savings": "Save $3.00",
    "conditions": "With digital coupon",
    "category": "Produce"
  }
]

Only return the JSON array, no other text.

HTML to parse:
${cleanedHtml}`;

          // Use MCP sampling to request AI completion
          const samplingResult = await this.server.server.createMessage({
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: prompt,
                },
              },
            ],
            maxTokens: 2000,
          });

          // Extract the text response
          const content = Array.isArray(samplingResult.content)
            ? samplingResult.content[0]
            : samplingResult.content;
          const dealsText =
            content?.type === "text"
              ? content.text
              : "Unable to extract deals";

          // Try to parse as JSON
          let dealsData;
          try {
            // Extract JSON from markdown code blocks if present
            const jsonMatch = dealsText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            const jsonText = jsonMatch ? jsonMatch[1] : dealsText;
            dealsData = JSON.parse(jsonText);
          } catch {
            // If parsing fails, return as formatted text
            dealsData = dealsText;
          }

          return {
            content: [
              {
                type: "text",
                text:
                  typeof dealsData === "string"
                    ? `**Weekly Deals (Zip: ${zipCode})**\n\n${dealsData}`
                    : `**Weekly Deals (Zip: ${zipCode})**\n\nFound ${dealsData.length} deals:\n\n${JSON.stringify(dealsData, null, 2)}`,
              },
            ],
          };
        } catch (error) {
          console.error("Error fetching weekly deals:", error);
          return {
            content: [
              {
                type: "text",
                text: `Failed to fetch weekly deals: ${error instanceof Error ? error.message : "Unknown error"}`,
              },
            ],
          };
        }
      },
    );

    // MCP Sampling tool: Search recipes from Janella's Cookbook
    this.server.registerTool(
      "search_recipes_from_web",
      {
        description:
          "Uses AI to scrape and extract recipes from Janella's Cookbook website. Searches for recipes by keyword and returns detailed recipe information including ingredients and instructions.",
        inputSchema: z.object({
          searchQuery: z
            .string()
            .min(1)
            .describe("Recipe search query (e.g., 'Cookie', 'Pasta', 'Chicken')"),
        }),
      },
      async ({ searchQuery }) => {
        try {
          // Fetch the recipe search results page
          const recipeUrl = `https://janella-cookbook.vercel.app/search?q=${encodeURIComponent(searchQuery)}`;
          console.log(`Fetching recipes from: ${recipeUrl}`);

          const response = await fetch(recipeUrl, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              Accept: "text/html,application/xhtml+xml,application/xml",
            },
          });

          if (!response.ok) {
            throw new Error(
              `Failed to fetch recipe page: ${response.status} ${response.statusText}`,
            );
          }

          const html = await response.text();

          // Extract just the body content (remove scripts, styles for cleaner parsing)
          const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
          const bodyContent = bodyMatch ? bodyMatch[1] : html;

          // Remove script and style tags
          const cleanedHtml = bodyContent
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
            .substring(0, 50000); // Limit to 50k chars to stay within token limits

          // Use sampling to have the LLM extract recipes
          const prompt = `Parse this recipe search results webpage HTML and extract recipe information.

For each recipe found, extract:
- Recipe name/title
- Description (if available)
- Ingredients list (as array)
- Cooking instructions (step-by-step)
- Prep time (if available)
- Cook time (if available)
- Servings (if available)
- Recipe URL or ID (if available)

Return the results as a structured JSON array. Example format:
[
  {
    "name": "Recipe name",
    "description": "Brief description",
    "ingredients": ["ingredient 1", "ingredient 2"],
    "instructions": ["Step 1", "Step 2"],
    "prepTime": "15 minutes",
    "cookTime": "30 minutes",
    "servings": "4",
    "url": "recipe-url-if-available"
  }
]

Only return the JSON array, no other text. Limit to 5 recipes maximum.

HTML to parse:
${cleanedHtml}`;

          // Use MCP sampling to request AI completion
          const samplingResult = await this.server.server.createMessage({
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: prompt,
                },
              },
            ],
            maxTokens: 2000,
          });

          // Extract the text response
          const content = Array.isArray(samplingResult.content)
            ? samplingResult.content[0]
            : samplingResult.content;
          const recipesText =
            content?.type === "text"
              ? content.text
              : "Unable to extract recipes";

          // Try to parse as JSON
          let recipesData;
          try {
            // Extract JSON from markdown code blocks if present
            const jsonMatch = recipesText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            const jsonText = jsonMatch ? jsonMatch[1] : recipesText;
            recipesData = JSON.parse(jsonText);
          } catch {
            // If parsing fails, return as formatted text
            recipesData = recipesText;
          }

          // Format the response
          if (typeof recipesData === "string") {
            return {
              content: [
                {
                  type: "text",
                  text: `**Recipe Search Results for "${searchQuery}"**\n\n${recipesData}`,
                },
              ],
            };
          }

          // Format as structured recipes
          const formattedRecipes = Array.isArray(recipesData)
            ? recipesData
                .map((recipe, idx) => {
                  const parts = [`**${idx + 1}. ${recipe.name}**`];

                  if (recipe.description) {
                    parts.push(`${recipe.description}`);
                  }

                  if (recipe.prepTime || recipe.cookTime || recipe.servings) {
                    const metadata = [];
                    if (recipe.prepTime) metadata.push(`Prep: ${recipe.prepTime}`);
                    if (recipe.cookTime) metadata.push(`Cook: ${recipe.cookTime}`);
                    if (recipe.servings) metadata.push(`Serves: ${recipe.servings}`);
                    parts.push(metadata.join(" | "));
                  }

                  if (recipe.ingredients && recipe.ingredients.length > 0) {
                    parts.push("\n**Ingredients:**");
                    recipe.ingredients.forEach((ing: string) => {
                      parts.push(`- ${ing}`);
                    });
                  }

                  if (recipe.instructions && recipe.instructions.length > 0) {
                    parts.push("\n**Instructions:**");
                    recipe.instructions.forEach((step: string, i: number) => {
                      parts.push(`${i + 1}. ${step}`);
                    });
                  }

                  return parts.join("\n");
                })
                .join("\n\n---\n\n")
            : JSON.stringify(recipesData, null, 2);

          return {
            content: [
              {
                type: "text",
                text: `**Recipe Search Results for "${searchQuery}"**\n\nFound ${Array.isArray(recipesData) ? recipesData.length : 0} recipes:\n\n${formattedRecipes}`,
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
                  error: "Invalid product URI format. Expected: shopping://product/{13-digit-upc}",
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

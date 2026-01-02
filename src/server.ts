import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import dotenv from "dotenv";
import { z } from "zod";
import { KrogerHandler } from "./kroger-handler.js";
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
import type {
  CircularsResponse,
  WeeklyDealsResponse,
} from "./services/kroger/weekly-deals.js";
import { registerPrompts } from "./prompts.js";
import {
  formatLocationList,
  formatLocation,
  formatProductList,
  formatWeeklyDealsList,
  formatPantryList,
  formatOrderHistory,
  formatPreferredLocation,
  type WeeklyDeal,
  type PantryItemDisplay,
  type OrderRecordDisplay,
  type PreferredLocationDisplay,
} from "./utils/format-response.js";
import {
  createUserStorage,
  type PantryItem,
  type OrderRecord,
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
    configureKrogerAuth(
      (): KrogerTokenInfo | null => {
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
      },
      (newTokenInfo) => {
        // Update props with new token information
        if (newTokenInfo.accessToken && this.props) {
          this.props.accessToken = newTokenInfo.accessToken;
        }
        if (newTokenInfo.refreshToken && this.props) {
          this.props.refreshToken = newTokenInfo.refreshToken;
        }
        if (newTokenInfo.tokenExpiresAt && this.props) {
          this.props.tokenExpiresAt = newTokenInfo.tokenExpiresAt;
        }
      },
    );

    // Add to cart tool
    this.server.tool(
      "add_to_cart",
      "Adds specified items to a user's shopping cart. Use this tool when the user wants to add products to their cart for purchase. Prefer to use add to cart with multiple items.",
      {
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
    this.server.tool(
      "search_locations",
      "Searches for Kroger store locations based on various filter criteria. Use this tool when the user needs to find nearby Kroger stores or specific store locations. Locations can be searched by zip code, latitude/longitude coordinates, radius, chain name, or department availability.",
      {
        zipCodeNear: z
          .string()
          .length(5, { message: "Zip code must be exactly 5 digits" })
          .default("98122"),
        limit: z.number().min(1).max(200).optional().default(1),
        chain: z.string().optional().default("QFC"),
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
    this.server.tool(
      "get_location_details",
      "Retrieves detailed information about a specific Kroger store location using its location ID. Use this tool when the user needs comprehensive information about a particular store, including address, hours, departments, and geolocation.",
      {
        locationId: z.string().length(8, {
          message: "Location ID must be exactly 8 characters long",
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
    // Search products tool
    this.server.tool(
      "search_products",
      "Searches for Kroger products based on various filter criteria. Use this tool when the user wants to find products by search term, brand, product ID, or other filters. Provides essential product details including pricing, availability.",
      {
        term: z
          .string()
          .max(100)
          .optional()
          .describe("Search term for products (e.g., 'milk', 'bread')"),
        locationId: z
          .string()
          .length(8, { message: "Location ID must be exactly 8 characters" })
          .describe(
            "Location ID to check product availability at a specific store",
          ),
        productId: z
          .string()
          .optional()
          .describe("Comma-separated list of specific product IDs to return"),
        start: z
          .number()
          .nonnegative()
          .optional()
          .describe("Number of products to skip (for pagination)"),
        limit: z
          .number()
          .min(1)
          .max(50)
          .optional()
          .describe("Number of products to return (maximum 50)")
          .default(10),
      },
      async ({ term, locationId, productId, start, limit }) => {
        // Validate that at least one search parameter is provided
        if (!term && !productId) {
          throw new Error(
            "At least one search parameter (term, productId, or brand) must be provided",
          );
        }

        // Build query parameters
        const queryParams: Record<string, string | number> = {};

        // Add required search parameters
        if (term) {
          queryParams["filter.term"] = term;
        }
        if (productId) {
          queryParams["filter.productId"] = productId;
        }

        // Add optional parameters
        if (locationId) {
          queryParams["filter.locationId"] = locationId;
        }
        queryParams["filter.fulfillment"] = "ais";
        if (start !== undefined) {
          queryParams["filter.start"] = start;
        }
        if (limit !== undefined) {
          queryParams["filter.limit"] = limit;
        } else {
          // Default limit to avoid too many results
          queryParams["filter.limit"] = 10;
        }

        // Make the API call to search for products
        const { data, error } = await productClient.GET("/v1/products", {
          params: {
            query: queryParams,
          },
        });

        if (error) {
          console.error("Error searching products:", error);
          throw new Error(
            `Failed to search products: ${JSON.stringify(error)}`,
          );
        }

        // Format the response for display
        const products = data?.data || [];
        console.log(`Found ${products.length} products`);

        if (products.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No products found matching your search criteria.",
              },
            ],
          };
        }

        // Return a successful response with formatted products
        const formattedProducts = formatProductList(products);

        return {
          content: [
            {
              type: "text",
              text: `Found ${products.length} product(s):\n\n${formattedProducts}`,
            },
          ],
        };
      },
    );

    // Get product details tool
    this.server.tool(
      "get_product_details",
      "Retrieves detailed information about a specific Kroger product using its product ID. Use this tool when the user needs comprehensive details about a particular product, including pricing, availability, nutritional information, and images.",
      {
        productId: z
          .string()
          .length(13, { message: "Product ID must be a 13-digit UPC number" }),
        locationId: z
          .string()
          .length(8, { message: "Location ID must be exactly 8 characters" })
          .optional()
          .describe(
            "Location ID to check product availability and pricing at a specific store",
          ),
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

    // Get weekly deals tool
    this.server.tool(
      "get_weekly_deals",
      "Retrieves current weekly deals and promotions from Kroger stores. Use this tool when the user wants to see current sales, discounts, or weekly specials. Returns the active weekly ad deals for the specified location. Example: 'Show me this week's deals at my local QFC'",
      {
        locationId: z
          .string()
          .length(8, { message: "Location ID must be exactly 8 characters" })
          .describe("The store location ID to get weekly deals for")
          .default("70500847"),
        divisionCode: z
          .string()
          .length(3, { message: "Division code must be exactly 3 characters" })
          .describe("The division code (e.g., '705' for QFC)")
          .default("705"),
      },
      async ({ locationId, divisionCode: _divisionCode }) => {
        try {
          // Step 1: Get the circulars list
          console.log("Fetching circulars for location:", locationId);

          // Create headers for the circulars request
          const circularsHeaders = new Headers();
          const xLafObject = [
            {
              modality: {
                type: "PICKUP",
                handoffLocation: {
                  storeId: locationId,
                  facilityId: "4468",
                },
              },
              sources: [
                {
                  storeId: locationId,
                  facilityId: "4468",
                },
              ],
              assortmentKeys: [locationId],
              listingKeys: [locationId],
            },
          ];
          circularsHeaders.append("x-laf-object", JSON.stringify(xLafObject));

          // Fetch circulars
          const circularsResponse = await fetch(
            "https://api.kroger.com/digitalads/v1/circulars",
            {
              method: "GET",
              headers: circularsHeaders,
            },
          );

          if (!circularsResponse.ok) {
            throw new Error(
              `Failed to fetch circulars: ${circularsResponse.status} ${circularsResponse.statusText}`,
            );
          }

          const circularsData: CircularsResponse =
            await circularsResponse.json();
          console.log(`Found ${circularsData.data.length} circulars`);

          // Find the current (non-preview) circular
          const currentCircular = circularsData.data.find(
            (c) => !c.previewCircular,
          );
          if (!currentCircular) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    message:
                      "No active weekly circular found for this location",
                    success: false,
                  }),
                },
              ],
            };
          }

          console.log(
            `Using circular ID: ${currentCircular.id} (${currentCircular.eventName})`,
          );

          // Step 2: Get the weekly deals for this circular
          const dealsHeaders = new Headers();
          dealsHeaders.append("x-laf-object", JSON.stringify(xLafObject));
          dealsHeaders.append("x-kroger-channel", "WEB");

          const dealsUrl = `https://www.qfc.com/atlas/v1/shoppable-weekly-deals/deals?filter.circularId=${currentCircular.id}`;
          console.log("Fetching deals from:", dealsUrl);

          const dealsResponse = await fetch(dealsUrl, {
            method: "GET",
            headers: dealsHeaders,
          });

          if (!dealsResponse.ok) {
            throw new Error(
              `Failed to fetch weekly deals: ${dealsResponse.status} ${dealsResponse.statusText}`,
            );
          }

          const dealsData: WeeklyDealsResponse = await dealsResponse.json();
          const deals = dealsData.data.shoppableWeeklyDeals.ads;

          console.log(`Found ${deals.length} weekly deals`);

          // Format the deals for display - only include relevant information
          const formattedDeals: WeeklyDeal[] = deals.slice(0, 20).map((deal) => ({
            product: deal.mainlineCopy,
            details: deal.underlineCopy,
            price: deal.retailPrice
              ? `$${deal.retailPrice.toFixed(2)}`
              : "See store",
            savings: deal.saveAmount
              ? `Save $${deal.saveAmount.toFixed(2)}`
              : deal.savePercent
                ? `Save ${deal.savePercent}%`
                : null,
            loyalty: deal.loyaltyIndicator,
            department: deal.departments[0]?.department || "General",
            validFrom: new Date(deal.validFrom).toLocaleDateString(),
            validTill: new Date(deal.validTill).toLocaleDateString(),
            disclaimer: deal.disclaimer || "",
          }));

          // Format the deals list
          const formattedDealsList = formatWeeklyDealsList(formattedDeals);
          const circularInfo = `**${currentCircular.eventName}**
Valid: ${new Date(currentCircular.eventStartDate).toLocaleDateString()} - ${new Date(currentCircular.eventEndDate).toLocaleDateString()}
Division: ${currentCircular.divisionName}`;

          // Return successful response
          return {
            content: [
              {
                type: "text",
                text: `Found ${deals.length} weekly deals:\n\n${circularInfo}\n\n${formattedDealsList}`,
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

    // Set preferred location tool
    this.server.tool(
      "set_preferred_location",
      "Sets the user's preferred store location for future shopping. Use this when the user wants to save their favorite store. This makes it easier to search products and check deals without specifying location each time.",
      {
        locationId: z
          .string()
          .length(8, { message: "Location ID must be exactly 8 characters" }),
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
          address: `${location.address?.addressLine1 || ""}, ${location.address?.city || ""}, ${location.address?.state || ""} ${location.address?.zipCode || ""}`.trim(),
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
    this.server.tool(
      "get_preferred_location",
      "Retrieves the user's saved preferred store location. Use this to check which store the user has set as their default for shopping.",
      {},
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
    this.server.tool(
      "add_to_pantry",
      "Adds items to your personal pantry inventory. Use this to track what groceries you already have at home. Helps avoid buying duplicates and manage inventory.",
      {
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
    this.server.tool(
      "remove_from_pantry",
      "Removes an item from your pantry inventory. Use this when you've used up an item or want to remove it from tracking.",
      {
        productId: z
          .string()
          .length(13, { message: "Product ID must be 13 digits" }),
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
    this.server.tool(
      "view_pantry",
      "Displays all items currently in your pantry inventory. Use this to see what groceries you have at home before shopping.",
      {},
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
    this.server.tool(
      "clear_pantry",
      "Removes all items from your pantry inventory. Use this to start fresh with pantry tracking.",
      {},
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
    this.server.tool(
      "mark_order_placed",
      "Records a completed order in your order history. Use this after successfully placing an order to track your purchases over time.",
      {
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
      },
      async ({ items, locationId, notes }) => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);

        // Generate order ID with timestamp
        const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const totalItems = items.reduce(
          (sum, item) => sum + item.quantity,
          0,
        );
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
    this.server.tool(
      "view_order_history",
      "Displays your past order history. Use this to see previous purchases and track shopping patterns. Returns most recent orders first.",
      {
        limit: z
          .number()
          .min(1)
          .max(50)
          .optional()
          .default(10)
          .describe("Number of recent orders to display"),
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
  }
}
export default new OAuthProvider({
  apiRoute: "/sse",
  apiHandler: MyMCP.mount("/sse"),
  // @ts-expect-error - Hono handler type mismatch with OAuthProvider
  defaultHandler: KrogerHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",

  /**
   * Token exchange callback - syncs Kroger tokens during MCP token refresh.
   * This ensures that when the MCP client refreshes its token, we also
   * refresh the Kroger token if needed, keeping both in sync.
   */
  tokenExchangeCallback: async ({ grantType, props }) => {
    // Only handle refresh token grants
    if (grantType !== "refresh_token") {
      return {};
    }

    const typedProps = props as Props;

    // Check if we have a refresh token and credentials
    if (!typedProps?.refreshToken || !typedProps?.tokenExpiresAt) {
      console.log("No Kroger refresh token available, keeping existing props");
      return {};
    }

    if (!typedProps?.krogerClientId || !typedProps?.krogerClientSecret) {
      console.log("No Kroger credentials in props, keeping existing props");
      return {};
    }

    // Check if Kroger token is expiring (with 5-minute buffer)
    if (!isKrogerTokenExpiring(typedProps.tokenExpiresAt)) {
      console.log("Kroger token still valid, no refresh needed");
      return {};
    }

    try {
      console.log("Refreshing Kroger token during MCP token exchange...");

      const refreshResult = await refreshKrogerToken(
        typedProps.refreshToken,
        typedProps.krogerClientId,
        typedProps.krogerClientSecret,
      );

      console.log("Kroger token refreshed successfully during token exchange");

      return {
        // Update props with new Kroger tokens
        newProps: {
          ...typedProps,
          accessToken: refreshResult.accessToken,
          refreshToken: refreshResult.refreshToken ?? typedProps.refreshToken,
          tokenExpiresAt: refreshResult.tokenExpiresAt,
        },
        // Match MCP access token TTL to Kroger's to keep them in sync
        accessTokenTTL: refreshResult.expiresIn,
      };
    } catch (error) {
      console.error(
        "Failed to refresh Kroger token during token exchange:",
        error,
      );
      // Return empty to keep existing props - the middleware will handle refresh
      return {};
    }
  },
});

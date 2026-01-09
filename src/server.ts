import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import dotenv from "dotenv";
import { z } from "zod";
import { KrogerHandler } from "./kroger-handler.js";
import { registerPrompts } from "./prompts.js";
import {
  configureKrogerAuth,
  isKrogerTokenExpiring,
  type KrogerTokenInfo,
  refreshKrogerToken,
} from "./services/kroger/client.js";
import { addToCart } from "./tools/cart-tools.js";
import { getCoupons } from "./tools/coupon-tools.js";
import {
  getLocationDetails,
  getPreferredLocation,
  searchLocations,
  setPreferredLocation,
} from "./tools/location-tools.js";
import {
  markOrderPlaced,
  viewOrderHistory,
} from "./tools/order-tools.js";
import {
  addToPantry,
  clearPantry,
  removeFromPantry,
  viewPantry,
} from "./tools/pantry-tools.js";
import {
  getProductDetails,
  searchProducts,
} from "./tools/product-tools.js";

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
      async ({ items }: { items: Array<{ upc: string; quantity: number; modality: "DELIVERY" | "PICKUP" }> }) => addToCart({ items }),
    );

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
      async ({ zipCodeNear, limit, chain }: { zipCodeNear: string; limit?: number; chain?: string }) =>
        searchLocations({ zipCodeNear, limit, chain }),
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
      async ({ locationId }: { locationId: string }) => getLocationDetails({ locationId }),
    );
    // Search products tool
    this.server.registerTool(
      "search_products",
      {
        description:
          "Searches for Kroger products based on various filter criteria. Use this tool when the user wants to find products by search term, brand, product ID, or other filters. Provides essential product details including pricing, availability.",
        inputSchema: z.object({
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
            .min(6)
            .max(50)
            .optional()
            .describe("Number of products to return (minimum 6, maximum 50)")
            .default(15),
        }),
      },
      async ({ term, locationId, productId, start, limit }: { term?: string; locationId: string; productId?: string; start?: number; limit?: number }) =>
        searchProducts({ term, locationId, productId, start, limit }),
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
      async ({ productId, locationId }: { productId: string; locationId?: string }) =>
        getProductDetails({ productId, locationId }),
    );

    // Get coupons tool
    this.server.registerTool(
      "get_coupons",
      {
        description:
          "Retrieves available digital coupons from QFC/Kroger. Use this tool when the user wants to see coupons, digital deals, or savings offers. Returns active coupons that can be clipped to the user's loyalty card. Example: 'Show me available coupons' or 'What coupons are available?'",
        inputSchema: z.object({
          locationId: z
            .string()
            .length(8, { message: "Location ID must be exactly 8 characters" })
            .describe("The store location ID to get coupons for")
            .default("70500847"),
          facilityId: z
            .string()
            .describe("The facility ID for the store")
            .default("4468"),
          filterWeeklyDeals: z
            .boolean()
            .optional()
            .default(false)
            .describe(
              "If true, only show Weekly Digital Deals (WDD) and Expiring For You (EFY) coupons",
            ),
        }),
      },
      async ({ locationId, facilityId, filterWeeklyDeals }: { locationId: string; facilityId: string; filterWeeklyDeals?: boolean }) =>
        getCoupons({ locationId, facilityId, filterWeeklyDeals }),
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
      async ({ locationId }: { locationId: string }) =>
        setPreferredLocation({ locationId }, this.props?.id || "", this.env.USER_DATA_KV),
    );

    // Get preferred location tool
    this.server.registerTool(
      "get_preferred_location",
      {
        description:
          "Retrieves the user's saved preferred store location. Use this to check which store the user has set as their default for shopping.",
        inputSchema: z.object({}),
      },
      async () => getPreferredLocation(this.props?.id || "", this.env.USER_DATA_KV),
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
      async ({ items }: { items: Array<{ productId: string; productName: string; quantity: number; expiresAt?: string }> }) =>
        addToPantry({ items }, this.props?.id || "", this.env.USER_DATA_KV),
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
      async ({ productId }: { productId: string }) =>
        removeFromPantry({ productId }, this.props?.id || "", this.env.USER_DATA_KV),
    );

    // View pantry tool
    this.server.registerTool(
      "view_pantry",
      {
        description:
          "Displays all items currently in your pantry inventory. Use this to see what groceries you have at home before shopping.",
        inputSchema: z.object({}),
      },
      async () => viewPantry(this.props?.id || "", this.env.USER_DATA_KV),
    );

    // Clear pantry tool
    this.server.registerTool(
      "clear_pantry",
      {
        description:
          "Removes all items from your pantry inventory. Use this to start fresh with pantry tracking.",
        inputSchema: z.object({}),
      },
      async () => clearPantry(this.props?.id || "", this.env.USER_DATA_KV),
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
      async ({ items, locationId, notes }: { items: Array<{ productId: string; productName: string; quantity: number; price?: number }>; locationId?: string; notes?: string }) =>
        markOrderPlaced({ items, locationId, notes }, this.props?.id || "", this.env.USER_DATA_KV),
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
      async ({ limit }: { limit?: number }) =>
        viewOrderHistory({ limit }, this.props?.id || "", this.env.USER_DATA_KV),
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

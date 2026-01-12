import OAuthProvider from "@cloudflare/workers-oauth-provider";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import dotenv from "dotenv";
import { KrogerHandler } from "./kroger-handler.js";
import { registerPrompts } from "./prompts.js";
import {
  configureKrogerAuth,
  isKrogerTokenExpiring,
  type KrogerTokenInfo,
  productClient,
  refreshKrogerToken,
} from "./services/kroger/client.js";
import { registerCartTools } from "./tools/cart-tools.js";
import { registerCouponTools } from "./tools/coupon-tools.js";
import { registerLocationTools } from "./tools/location-tools.js";
import { registerOrderTools } from "./tools/order-tools.js";
import { registerPantryTools } from "./tools/pantry-tools.js";
import { registerProductTools } from "./tools/product-tools.js";
import { createUserStorage } from "./utils/user-storage.js";

// Context from the auth process, encrypted & stored in the auth token
// and provided to the DurableMCP as this.props
export type Props = {
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

    // Helper function to get current props
    const getProps = () => this.props;

    // Register all MCP tools
    registerCartTools(this.server, this.env, getProps);
    registerLocationTools(this.server, this.env, getProps);
    registerProductTools(this.server);
    registerPantryTools(this.server, this.env, getProps);
    registerOrderTools(this.server, this.env, getProps);
    registerCouponTools(this.server, this.env, getProps);

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

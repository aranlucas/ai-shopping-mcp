import OAuthProvider, { GrantType } from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { KrogerHandler } from "./kroger-handler.js";
import { registerPrompts } from "./prompts.js";
import {
  configureKrogerAuth,
  isKrogerTokenExpiring,
  refreshKrogerToken,
} from "./services/kroger/client.js";
import { registerCartTools } from "./tools/cart.js";
import { registerInventoryTools } from "./tools/inventory.js";
import { registerLocationTools } from "./tools/location.js";
import { registerProductTools } from "./tools/product.js";
import { registerRecipeTools } from "./tools/recipes.js";
import { registerResources } from "./tools/resources.js";
import { registerShoppingListTools } from "./tools/shopping-list.js";
import type { GrantProps, Props } from "./tools/types.js";

export class MyMCP extends McpAgent<Env, unknown, Props> {
  server = new McpServer({
    name: "kroger-ai-assistant",
    version: "1.0.0",
  });

  async init() {
    // Props (id, accessToken, tokenExpiresAt) is a superset of KrogerTokenInfo — pass directly
    configureKrogerAuth(() => this.props ?? null);

    // Shared context for all tool/resource registration functions
    const ctx = {
      server: this.server,
      getProps: () => this.props,
      getEnv: () => this.env,
    };

    // Register all MCP features
    registerPrompts(this.server);
    registerCartTools(ctx);
    registerLocationTools(ctx);
    registerProductTools(ctx);
    registerInventoryTools(ctx);
    registerRecipeTools(ctx);
    registerShoppingListTools(ctx);
    registerResources(ctx);
  }
}

export default new OAuthProvider({
  apiHandlers: {
    "/sse": MyMCP.serveSSE("/sse"), // deprecated SSE protocol - use /mcp instead
    "/mcp": MyMCP.serve("/mcp"), // Streamable-HTTP protocol
  },
  // biome-ignore lint/suspicious/noExplicitAny: Hono app type incompatible with OAuthProvider's ExportedHandler type
  defaultHandler: KrogerHandler as any,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",

  // Syncs Kroger tokens with MCP token lifecycle using accessTokenProps/newProps separation:
  // - accessTokenProps: only what middleware needs (id, accessToken, tokenExpiresAt)
  // - newProps: full grant including Kroger refresh token + credentials (stays server-side)
  // CRITICAL: Kroger single-use refresh tokens — only refreshed here to persist to grant.
  tokenExchangeCallback: async ({ grantType, props }) => {
    // Destructure grant-only fields; rest is exactly the access token props (Props type)
    const {
      refreshToken,
      krogerClientId,
      krogerClientSecret,
      ...accessTokenProps
    } = props as GrantProps;

    if (grantType === GrantType.AUTHORIZATION_CODE) {
      const ttl = accessTokenProps.tokenExpiresAt
        ? Math.max(
            Math.floor((accessTokenProps.tokenExpiresAt - Date.now()) / 1000),
            60,
          )
        : 1800;
      return { accessTokenProps, accessTokenTTL: ttl };
    }

    if (grantType !== GrantType.REFRESH_TOKEN) return {};

    if (!refreshToken || !krogerClientId || !krogerClientSecret) {
      return { accessTokenTTL: 1 }; // Force re-auth
    }

    if (!isKrogerTokenExpiring(accessTokenProps.tokenExpiresAt)) {
      return { accessTokenProps };
    }

    try {
      const result = await refreshKrogerToken(
        refreshToken,
        krogerClientId,
        krogerClientSecret,
      );

      if (!result.refreshToken) {
        console.error(
          "Kroger refresh missing new refresh token (single-use). Re-auth required.",
        );
        return { accessTokenTTL: 1 };
      }

      return {
        accessTokenProps: {
          ...accessTokenProps,
          accessToken: result.accessToken,
          tokenExpiresAt: result.tokenExpiresAt,
        },
        newProps: {
          ...accessTokenProps,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          tokenExpiresAt: result.tokenExpiresAt,
          krogerClientId,
          krogerClientSecret,
        },
        accessTokenTTL: result.expiresIn,
      };
    } catch (error) {
      console.error(
        "Kroger token refresh failed:",
        error instanceof Error ? error.message : String(error),
      );
      return { accessTokenTTL: 1 };
    }
  },
});

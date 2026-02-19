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
    // Configure Kroger auth middleware — only needs access token info for API calls
    configureKrogerAuth(() => {
      if (!this.props?.accessToken) return null;
      return {
        accessToken: this.props.accessToken,
        tokenExpiresAt: this.props.tokenExpiresAt,
      };
    });

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

  /**
   * Token exchange callback — syncs Kroger tokens with MCP token lifecycle.
   *
   * Uses accessTokenProps/newProps separation per the library's README pattern:
   * - accessTokenProps: minimal data for runtime API calls (sent with every request)
   * - newProps: full grant data including Kroger refresh token + credentials (stays server-side)
   *
   * CRITICAL: Kroger uses single-use refresh tokens. This callback is the ONLY
   * place that refreshes them, ensuring the new token is persisted to the grant.
   */
  tokenExchangeCallback: async ({ grantType, props }) => {
    const grant = props as GrantProps;

    // Initial auth code exchange — strip grant-only fields from access token
    if (grantType === GrantType.AUTHORIZATION_CODE) {
      const remainingSeconds = grant?.tokenExpiresAt
        ? Math.max(Math.floor((grant.tokenExpiresAt - Date.now()) / 1000), 60)
        : 1800;

      return {
        accessTokenProps: {
          id: grant.id,
          accessToken: grant.accessToken,
          tokenExpiresAt: grant.tokenExpiresAt,
        },
        accessTokenTTL: remainingSeconds,
      };
    }

    if (grantType !== GrantType.REFRESH_TOKEN) {
      return {};
    }

    // Validate grant has refresh credentials
    if (
      !grant?.refreshToken ||
      !grant?.krogerClientId ||
      !grant?.krogerClientSecret
    ) {
      return { accessTokenTTL: 1 }; // Force re-auth
    }

    // Skip refresh if Kroger token is still valid (5-minute buffer)
    if (!isKrogerTokenExpiring(grant.tokenExpiresAt)) {
      return {
        accessTokenProps: {
          id: grant.id,
          accessToken: grant.accessToken,
          tokenExpiresAt: grant.tokenExpiresAt,
        },
      };
    }

    try {
      const result = await refreshKrogerToken(
        grant.refreshToken,
        grant.krogerClientId,
        grant.krogerClientSecret,
      );

      if (!result.refreshToken) {
        console.error(
          "Token exchange callback: Kroger refresh missing new refresh token (single-use). Re-auth required.",
        );
        return { accessTokenTTL: 1 };
      }

      return {
        // Access token gets only what middleware needs
        accessTokenProps: {
          id: grant.id,
          accessToken: result.accessToken,
          tokenExpiresAt: result.tokenExpiresAt,
        },
        // Grant persists full data including new refresh token + credentials
        newProps: {
          ...grant,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          tokenExpiresAt: result.tokenExpiresAt,
        },
        accessTokenTTL: result.expiresIn,
      };
    } catch (error) {
      console.error(
        "Token exchange callback: Kroger refresh failed:",
        error instanceof Error ? error.message : String(error),
      );
      return { accessTokenTTL: 1 };
    }
  },
});

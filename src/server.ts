import OAuthProvider, { GrantType } from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { KrogerHandler } from "./kroger-handler.js";
import { registerPrompts } from "./prompts.js";
import {
  createKrogerClients,
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
import type { GrantProps, Props, ToolContext } from "./tools/types.js";
import { registerWeeklyDealsTools } from "./tools/weekly-deals.js";
import { createUserStorage } from "./utils/user-storage.js";

export class MyMCP extends McpAgent<Env, unknown, Props> {
  server = new McpServer(
    {
      name: "kroger-ai-assistant",
      version: "1.0.0",
    },
    {
      instructions:
        "AI shopping assistant for Kroger/QFC stores. Manage shopping lists, search products, find store locations, track pantry inventory, and plan meals. Use MCP Resources to read user context (pantry, equipment, shopping list, preferred location) before making suggestions.",
    },
  );

  async init() {
    const clients = createKrogerClients(() => this.props ?? null);
    const storage = createUserStorage(this.env.USER_DATA_KV);

    const ctx: ToolContext = {
      server: this.server,
      clients,
      storage,
      getUser: () => this.props ?? null,
      getEnv: () => this.env,
      getSessionId: () => this.getSessionId(),
      keepAliveWhile: <T>(fn: () => Promise<T>) => this.keepAliveWhile(fn),
    };

    // Register all MCP features
    registerPrompts(this.server);
    registerCartTools(ctx);
    registerLocationTools(ctx);
    registerProductTools(ctx);
    registerInventoryTools(ctx);
    registerRecipeTools(ctx);
    registerShoppingListTools(ctx);
    registerWeeklyDealsTools(ctx);
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

    return (
      await refreshKrogerToken(
        refreshToken,
        krogerClientId,
        krogerClientSecret,
      ).orTee((error) =>
        console.error("Kroger token refresh failed:", error.message),
      )
    ).match(
      (result) => {
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
      },
      () => ({ accessTokenTTL: 1 }),
    );
  },
});

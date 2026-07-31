import OAuthProvider, { GrantType } from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { WorkerEntrypoint } from "cloudflare:workers";

import type { KrogerTokenInfo } from "./services/kroger/client.js";
import type { GrantProps, Props, ToolContext } from "./tools/types.js";

import { KrogerHandler } from "./kroger-handler.js";
import { registerPrompts } from "./prompts.js";
import {
  createKrogerClients,
  isKrogerTokenExpiring,
  refreshKrogerToken,
} from "./services/kroger/client.js";
import { ProductService } from "./services/kroger/product-service.js";
import { registerCartTools } from "./tools/cart.js";
import { registerInventoryTools } from "./tools/inventory.js";
import { registerLocationTools } from "./tools/location.js";
import { registerOrderTools } from "./tools/orders.js";
import { registerProductTools } from "./tools/product.js";
import { registerRecipeTools } from "./tools/recipes.js";
import { registerResources } from "./tools/resources.js";
import { registerShopTools } from "./tools/shop.js";
import { registerShoppingListTools } from "./tools/shopping-list.js";
import { registerWeeklyDealsTools } from "./tools/weekly-deals.js";
import { getUserDataKv } from "./utils/kv.js";
import { getProps } from "./utils/result.js";
import { createShoppingPersistence } from "./utils/user-storage.js";
import { APP_VIEW_URI, registerViewResource } from "./utils/view-resource.js";

/**
 * Tool/resource registrars, each invoked with the shared ToolContext.
 * Add a new tool module here — registration order is not significant.
 */
const TOOL_REGISTRARS: Array<(ctx: ToolContext) => void> = [
  registerCartTools,
  registerLocationTools,
  registerProductTools,
  registerInventoryTools,
  registerOrderTools,
  registerRecipeTools,
  registerShoppingListTools,
  registerShopTools,
  registerWeeklyDealsTools,
  registerResources,
];

const SERVER_INFO = { name: "kroger-ai-assistant", version: "1.0.0" } as const;
const SERVER_OPTIONS = {
  instructions:
    "AI shopping assistant for Kroger/QFC stores. Golden path: call shop_for_items with a list of item names for one-shot shopping-list creation, OR search_products then create_shopping_list for more control — then add_shopping_list_to_cart with the returned listId to add items to the Kroger cart. Call get_shopping_profile before personalized suggestions to read the user's preferred store, pantry, kitchen equipment, and frequently purchased items. Other tools: search_stores/get_store/set_preferred_store for store lookup, add_to_inventory/remove_from_inventory for pantry and kitchen equipment, record_order to log completed purchases, get_weekly_deals for current sales, and get_meal_planning_context for recipe suggestions from pantry contents.",
} as const;

/**
 * Builds a fresh `McpServer` with all tools/resources/prompts registered.
 *
 * `createMcpHandler` is stateless: a new server is created per request so
 * responses cannot leak between clients. Auth `Props` are read lazily from
 * `getMcpAuthContext()` (populated by `OAuthProvider` and wrapped in the
 * handler's AsyncLocalStorage), so registration itself needs no auth context.
 */
function buildServer(env: Env): McpServer {
  const server = new McpServer(SERVER_INFO, SERVER_OPTIONS);

  const clients = createKrogerClients((): KrogerTokenInfo | null => {
    const props = getMcpAuthContext()?.props;
    if (
      !props ||
      typeof props.accessToken !== "string" ||
      typeof props.tokenExpiresAt !== "number"
    ) {
      return null;
    }
    return { accessToken: props.accessToken, tokenExpiresAt: props.tokenExpiresAt };
  }, getUserDataKv(env));

  const storage = createShoppingPersistence(env.USER_DATA_KV, () => ({
    userId: getProps().id,
  }));
  const productService = new ProductService(clients.productClient);

  const ctx: ToolContext = {
    server,
    clients,
    productService,
    storage,
    getEnv: () => env,
  };

  // Register the single unified View resource (all app tools share this one UI)
  registerViewResource(ctx, APP_VIEW_URI, "mcp-app.html");

  // Register all MCP features
  registerPrompts(server);
  for (const register of TOOL_REGISTRARS) register(ctx);

  return server;
}

/**
 * MCP SDK v2 stateless handler. The factory builds a fresh server for every
 * request and the Agents wrapper bridges OAuth props into getMcpAuthContext().
 * The handler retains the SDK's default stateless compatibility path for
 * 2025-era MCP clients while serving the stable 2026 protocol.
 */
const mcpApiHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const handler = createMcpHandler(() => buildServer(env), { route: "/mcp" });

    return handler(request, env, ctx);
  },
};

class UserInfoHandler extends WorkerEntrypoint<Env, Props> {
  fetch() {
    return Response.json({
      sub: this.ctx.props.id,
      id: this.ctx.props.id,
    });
  }
}

export default new OAuthProvider({
  apiHandlers: {
    "/mcp": mcpApiHandler,
    "/userinfo": UserInfoHandler,
  },
  // biome-ignore lint/suspicious/noExplicitAny: Hono app type incompatible with OAuthProvider's ExportedHandler type
  defaultHandler: KrogerHandler as any,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  allowPlainPKCE: false,
  clientIdMetadataDocumentEnabled: true,
  scopesSupported: ["profile.compact", "cart.basic:write", "product.compact"],

  // Syncs Kroger tokens with MCP token lifecycle using accessTokenProps/newProps separation:
  // - accessTokenProps: only what middleware needs (id, accessToken, tokenExpiresAt)
  // - newProps: full grant including Kroger refresh token + credentials (stays server-side)
  // CRITICAL: Kroger single-use refresh tokens — only refreshed here to persist to grant.
  tokenExchangeCallback: async ({ grantType, props }) => {
    // Destructure grant-only fields; rest is exactly the access token props (Props type)
    const { refreshToken, krogerClientId, krogerClientSecret, ...accessTokenProps } =
      props as GrantProps;

    if (grantType === GrantType.AUTHORIZATION_CODE) {
      const ttl = accessTokenProps.tokenExpiresAt
        ? Math.max(Math.floor((accessTokenProps.tokenExpiresAt - Date.now()) / 1000), 60)
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
      await refreshKrogerToken(refreshToken, krogerClientId, krogerClientSecret).orTee((error) =>
        console.error("Kroger token refresh failed:", error.message),
      )
    ).match(
      (result) => {
        if (!result.refreshToken) {
          console.error("Kroger refresh missing new refresh token (single-use). Re-auth required.");
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

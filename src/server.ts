import OAuthProvider, { GrantType, OAuthError } from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp";
import { WorkerEntrypoint } from "cloudflare:workers";

import type { KrogerTokenInfo } from "./services/kroger/client.js";
import type { GrantProps, Props, ToolContext } from "./tools/types.js";

import { KrogerWorker } from "./kroger-handler.js";
import { createMcpTransportStorage } from "./mcp-transport-storage.js";
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
 * `sessionId` is the per-request MCP session used to scope user storage.
 */
function buildServer(env: Env, sessionId: string): McpServer {
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
    sessionId,
  }));
  const productService = new ProductService(clients.productClient);

  const ctx: ToolContext = {
    server,
    clients,
    productService,
    storage,
    getEnv: () => env,
    getSessionId: () => sessionId,
  };

  // Register the single unified View resource (all app tools share this one UI)
  registerViewResource(ctx, APP_VIEW_URI, "mcp-app.html");

  // Register all MCP features
  registerPrompts(server);
  for (const register of TOOL_REGISTRARS) register(ctx);

  return server;
}

/**
 * Stateless MCP API handler.
 *
 * The MCP session id is carried by the client in the `Mcp-Session-Id` header
 * after the server issues it on `initialize`. Because each request spins up a
 * fresh `WorkerTransport`, its minimal protocol state is persisted in the
 * existing user-scoped KV namespace and restored on follow-up requests.
 */
const mcpApiHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const headerSessionId = request.headers.get("mcp-session-id") ?? undefined;
    const sessionId = headerSessionId ?? crypto.randomUUID();

    const handler = createMcpHandler(buildServer(env, sessionId), {
      route: "/mcp",
      sessionIdGenerator: () => sessionId,
      storage: createMcpTransportStorage(env.USER_DATA_KV, headerSessionId, () => getProps().id),
    });

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

export const oauthProvider = new OAuthProvider<Env>({
  apiHandlers: {
    "/mcp": mcpApiHandler,
    "/userinfo": UserInfoHandler,
  },
  defaultHandler: KrogerWorker,
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
      throw new OAuthError("invalid_grant", {
        description: "Kroger authorization is incomplete. Reconnect the MCP server.",
      });
    }

    if (!isKrogerTokenExpiring(accessTokenProps.tokenExpiresAt)) {
      const ttl = Math.max(Math.floor((accessTokenProps.tokenExpiresAt - Date.now()) / 1000), 60);
      return { accessTokenProps, accessTokenTTL: ttl };
    }

    const refreshResult = await refreshKrogerToken(
      refreshToken,
      krogerClientId,
      krogerClientSecret,
    );
    if (refreshResult.isErr()) {
      const error = refreshResult.error;
      console.error("Kroger token refresh failed:", error.message);

      const upstreamCode =
        error.type === "API_ERROR" &&
        error.detail &&
        typeof error.detail === "object" &&
        !(error.detail instanceof Error) &&
        typeof error.detail.error === "string"
          ? error.detail.error
          : undefined;

      if (upstreamCode === "invalid_grant" || upstreamCode === "invalid_client") {
        throw new OAuthError("invalid_grant", {
          description: "Kroger authorization expired. Reconnect the MCP server.",
        });
      }

      if (error.type === "API_ERROR" && error.status === 429) {
        throw new OAuthError("temporarily_unavailable", {
          description: "Kroger rate limited the token refresh. Try again shortly.",
          statusCode: 429,
          headers: { "Retry-After": "60" },
        });
      }

      throw new OAuthError("temporarily_unavailable", {
        description: "Kroger token refresh is temporarily unavailable. Try again shortly.",
        statusCode: 503,
        headers: { "Retry-After": "60" },
      });
    }

    const result = refreshResult.value;
    if (!result.refreshToken) {
      console.error("Kroger refresh missing new refresh token (single-use). Re-auth required.");
      throw new OAuthError("invalid_grant", {
        description: "Kroger did not rotate the refresh token. Reconnect the MCP server.",
      });
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
});

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return oauthProvider.fetch(request, env, ctx);
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const result = await oauthProvider.purgeExpiredData(env, { batchSize: 100 });
    console.log("OAuth KV cleanup complete:", result);
  },
} satisfies ExportedHandler<Env>;

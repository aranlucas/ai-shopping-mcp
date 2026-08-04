import OAuthProvider, { GrantType, OAuthError } from "@cloudflare/workers-oauth-provider";
import * as Sentry from "@sentry/cloudflare";
import {
  createRequestStateCodec,
  McpServer,
  type McpRequestContext,
} from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { WorkerEntrypoint } from "cloudflare:workers";

import type { AppEnv } from "./env.js";
import type { CartConfirmationState } from "./cart-confirmation.js";
import type { KrogerTokenInfo } from "./services/kroger/client.js";
import type { GrantProps, Props, ToolContext } from "./tools/types.js";

import { KrogerWorker } from "./kroger-handler.js";
import { registerPrompts } from "./prompts.js";
import {
  createKrogerClients,
  isKrogerTokenExpiring,
  refreshKrogerToken,
} from "./services/kroger/client.js";
import { createGatewayClient } from "./services/gateway/client.js";
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
import { createKrogerCatalogProvider } from "./services/catalog/kroger-provider.js";
import { createTraderJoesCatalogProvider } from "./services/catalog/trader-joes-provider.js";
import { createTraderJoesClient } from "./services/traderjoes/client.js";
import { getUserDataKv } from "./utils/kv.js";
import { createGatewayShoppingStore } from "./utils/gateway-storage.js";
import { getProps } from "./utils/result.js";
import { createCartPersistence } from "./utils/user-storage.js";
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
    "AI grocery shopping assistant. Preferred store, pantry, equipment, orders, and lists are shared with the user's agents household library. Golden path: call shop_for_items with item names for one-shot shopping-list creation, OR search_products then create_shopping_list for more control — then add_shopping_list_to_cart with the returned listId to fill the cart. Edit a saved list with get_shopping_list (for listIds and itemIds), add_shopping_list_items, and edit_shopping_list_item; items take a upc or any productName. search_products takes providers: kroger (default) and trader_joes (catalog only; its sku never reaches a cart). Cart, store, and deal tools are Kroger-backed. Call get_shopping_profile before personalized suggestions. Other tools: search_stores/get_store/set_preferred_store for stores, add_to_inventory/remove_from_inventory for pantry and equipment, record_order to log purchases, get_weekly_deals for sales, get_meal_planning_context for recipes from pantry contents.",
} as const;

function requestBearerToken(requestContext: McpRequestContext): string | undefined {
  const validatedToken = requestContext.authInfo?.token?.trim();
  if (validatedToken) return validatedToken;

  const header = requestContext.requestInfo?.headers.get("authorization")?.trim();
  if (!header) return undefined;
  const match = /^Bearer[ \t]+([^ \t]+)$/i.exec(header);
  return match?.[1];
}

/**
 * Builds a fresh `McpServer` with all tools/resources/prompts registered.
 *
 * `createMcpHandler` is stateless: a new server is created per request so
 * responses cannot leak between clients. Auth `Props` are read lazily from
 * `getMcpAuthContext()` (populated by `OAuthProvider` and wrapped in the
 * handler's AsyncLocalStorage), so registration itself needs no auth context.
 * Cart retry receipts are scoped by the authenticated OAuth client rather
 * than MCP transport state, so the server remains stateless at the protocol
 * layer.
 */
function buildServer(env: AppEnv, requestContext: McpRequestContext): McpServer {
  const clientId = requestContext.authInfo?.clientId ?? getProps().id;
  const userId = getProps().id;
  const requestStateCodec = createRequestStateCodec<CartConfirmationState>({
    key: `${env.COOKIE_ENCRYPTION_KEY}\0mcp-request-state-v1`,
    bind: ({ mcpReq }) => `${mcpReq.method}\0${clientId}\0${userId}`,
  });
  const server = new McpServer(SERVER_INFO, {
    ...SERVER_OPTIONS,
    requestState: { verify: requestStateCodec.verify },
  });

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

  const gatewayToken = requestBearerToken(requestContext);
  if (!gatewayToken) {
    throw new Error("Authenticated MCP request is missing its bearer token");
  }
  const gatewayClient = createGatewayClient(env.GATEWAY_URL, gatewayToken);
  const storage = createGatewayShoppingStore(gatewayClient);
  const carts = createCartPersistence(env.USER_DATA_KV, () => ({
    userId: getProps().id,
    clientId,
  }));
  const productService = new ProductService(clients.productClient);
  const catalogs = {
    kroger: createKrogerCatalogProvider(clients.productClient),
    trader_joes: createTraderJoesCatalogProvider(
      createTraderJoesClient({
        ...(env.TRADER_JOES_GRAPHQL_URL === undefined
          ? {}
          : { endpoint: env.TRADER_JOES_GRAPHQL_URL }),
        ...(env.TRADER_JOES_STORE_CODE === undefined
          ? {}
          : { storeCode: env.TRADER_JOES_STORE_CODE }),
        kv: getUserDataKv(env),
      }),
    ),
  } as const;

  const ctx: ToolContext = {
    server,
    clients,
    productService,
    catalogs,
    storage,
    carts,
    requestStateCodec,
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
 * Stateless MCP API handler.
 *
 * The SDK v2 factory creates a fresh server for every request and serves both
 * the modern protocol and the built-in stateless legacy compatibility lane.
 */
const mcpApiHandler = {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
    const handler = createMcpHandler((requestContext) => buildServer(env, requestContext), {
      route: "/mcp",
    });

    return handler(request, env, ctx);
  },
};

class UserInfoHandler extends WorkerEntrypoint<AppEnv, Props> {
  fetch() {
    return Response.json({
      sub: this.ctx.props.id,
      id: this.ctx.props.id,
    });
  }
}

export const oauthProvider = new OAuthProvider<AppEnv>({
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

// Errors-only Sentry: no tracesSampleRate, and without SENTRY_DSN the SDK
// stays disabled so local dev and unconfigured deploys are unaffected.
export default Sentry.withSentry(
  (env: AppEnv) => ({
    dsn: env.SENTRY_DSN,
    enabled: Boolean(env.SENTRY_DSN),
  }),
  {
    fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
      return oauthProvider.fetch(request, env, ctx);
    },
    async scheduled(
      _controller: ScheduledController,
      env: AppEnv,
      _ctx: ExecutionContext,
    ): Promise<void> {
      const result = await oauthProvider.purgeExpiredData(env, { batchSize: 100 });
      console.log("OAuth KV cleanup complete:", result);
    },
  } satisfies ExportedHandler<AppEnv>,
);

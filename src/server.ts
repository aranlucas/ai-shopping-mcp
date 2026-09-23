import {
  GrantType,
  OAuthError,
  OAuthProvider,
} from "@cloudflare/workers-oauth-provider";
import * as Sentry from "@sentry/cloudflare";
import {
  McpServer,
  type McpRequestContext,
} from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { WorkerEntrypoint } from "cloudflare:workers";

import type { AppEnv } from "./env.js";
import type { KrogerTokenInfo } from "./services/kroger/client.js";
import type { GrantProps, Props, ToolContext } from "./tools/types.js";

import { KrogerWorker } from "./kroger-handler.js";
import { registerPrompts } from "./prompts.js";
import {
  createKrogerClients,
  isKrogerTokenExpiring,
  refreshKrogerToken,
} from "./services/kroger/client.js";
import { createD1ShoppingStore } from "./utils/d1-shopping-storage.js";
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
import { isVerifiedShopperId } from "./utils/shopper-identity.js";
import { createCartPersistence } from "./utils/user-storage.js";
import { APP_VIEW_URI, registerViewResource } from "./utils/view-resource.js";

export { CartOperations } from "./cart-operations.js";

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

const SERVER_INFO = {
  name: "grocery-shopping-assistant",
  version: "1.1.0",
} as const;
const SERVER_OPTIONS = {
  instructions:
    "Kroger grocery assistant with stores, pantry, equipment, orders, and lists. Use shop_for_items for one-shot shopping, or search_products then create_shopping_list and pass its listId to add_shopping_list_to_cart. Copy exact UPCs from search results into lists and orders; storeId selects the Kroger store. Edit lists with get_shopping_list, add_shopping_list_items, and edit_shopping_list_item. Use get_shopping_profile before personalized suggestions.",
} as const;

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
function buildServer(
  env: AppEnv,
  requestContext: McpRequestContext,
): McpServer {
  const clientId = requestContext.authInfo?.clientId ?? getProps().id;
  const server = new McpServer(SERVER_INFO, SERVER_OPTIONS);

  const clients = createKrogerClients(
    (): KrogerTokenInfo | null => {
      const props = getMcpAuthContext()?.props;
      if (
        !props ||
        typeof props.accessToken !== "string" ||
        typeof props.tokenExpiresAt !== "number"
      ) {
        return null;
      }
      return {
        accessToken: props.accessToken,
        tokenExpiresAt: props.tokenExpiresAt,
      };
    },
    getUserDataKv(env),
    requestContext.requestInfo?.signal,
  );

  const storage = createD1ShoppingStore(env.SHOPPING_DB, getProps().id);
  const journal = env.CART_OPERATIONS.getByName(getProps().id);
  const carts = createCartPersistence(
    env.USER_DATA_KV,
    () => ({
      userId: getProps().id,
      clientId,
    }),
    {
      begin: (key, fingerprint) =>
        journal.begin(JSON.stringify([clientId, key]), fingerprint),
      reconcileLegacy: (key, attempt, fingerprint, legacyFingerprint) =>
        journal.reconcileLegacy(
          JSON.stringify([clientId, key]),
          attempt,
          fingerprint,
          legacyFingerprint,
        ),
      complete: (key, attempt) =>
        journal.complete(JSON.stringify([clientId, key]), attempt),
      reject: (key, attempt) =>
        journal.reject(JSON.stringify([clientId, key]), attempt),
    },
  );
  const productService = new ProductService(clients.productClient);

  const ctx: ToolContext = {
    server,
    clients,
    productService,
    storage,
    carts,
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
  async fetch(
    request: Request,
    env: AppEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const handler = createMcpHandler(
      (requestContext) => buildServer(env, requestContext),
      {
        route: "/mcp",
      },
    );

    return handler(request, env, ctx);
  },
};

class UserInfoHandler extends WorkerEntrypoint<AppEnv, Props> {
  fetch() {
    if (!isVerifiedShopperId(this.ctx.props.id))
      return Response.json({ error: "invalid_token" }, { status: 401 });
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
    if (!isVerifiedShopperId(props.id)) {
      throw new OAuthError("invalid_grant", {
        description:
          "Kroger identity could not be verified. Reconnect the MCP server.",
      });
    }
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
      throw new OAuthError("invalid_grant", {
        description:
          "Kroger authorization is incomplete. Reconnect the MCP server.",
      });
    }

    if (!isKrogerTokenExpiring(accessTokenProps.tokenExpiresAt)) {
      const ttl = Math.max(
        Math.floor((accessTokenProps.tokenExpiresAt - Date.now()) / 1000),
        60,
      );
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

      if (
        upstreamCode === "invalid_grant" ||
        upstreamCode === "invalid_client"
      ) {
        throw new OAuthError("invalid_grant", {
          description:
            "Kroger authorization expired. Reconnect the MCP server.",
        });
      }

      if (error.type === "API_ERROR" && error.status === 429) {
        throw new OAuthError("temporarily_unavailable", {
          description:
            "Kroger rate limited the token refresh. Try again shortly.",
          statusCode: 429,
          headers: { "Retry-After": "60" },
        });
      }

      throw new OAuthError("temporarily_unavailable", {
        description:
          "Kroger token refresh is temporarily unavailable. Try again shortly.",
        statusCode: 503,
        headers: { "Retry-After": "60" },
      });
    }

    const result = refreshResult.value;
    if (!result.refreshToken) {
      console.error(
        "Kroger refresh missing new refresh token (single-use). Re-auth required.",
      );
      throw new OAuthError("invalid_grant", {
        description:
          "Kroger did not rotate the refresh token. Reconnect the MCP server.",
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
    fetch(
      request: Request,
      env: AppEnv,
      ctx: ExecutionContext,
    ): Promise<Response> {
      return oauthProvider.fetch(request, env, ctx);
    },
    async scheduled(
      _controller: ScheduledController,
      env: AppEnv,
      _ctx: ExecutionContext,
    ): Promise<void> {
      const result = await oauthProvider.purgeExpiredData(env, {
        batchSize: 100,
      });
      console.log("OAuth KV cleanup complete:", result);
    },
  } satisfies ExportedHandler<AppEnv>,
);

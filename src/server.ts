import {
  GrantType,
  OAuthError,
  OAuthProvider,
} from "@cloudflare/workers-oauth-provider";
import * as Sentry from "@sentry/cloudflare";
import type { McpRequestContext } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { WorkerEntrypoint } from "cloudflare:workers";

import type { AppEnv } from "./env.js";
import type { GrantProps, Props } from "./tools/types.js";

import {
  createRequestContainer,
  registerRequestFeatures,
} from "./composition.js";
import { KrogerWorker } from "./kroger-handler.js";
import { registerPrompts } from "./prompts.js";
import {
  isKrogerTokenExpiring,
  refreshKrogerToken,
} from "./services/kroger/client.js";
import { isVerifiedShopperId } from "./utils/shopper-identity.js";
import { APP_VIEW_URI, registerViewResource } from "./utils/view-resource.js";

export { CartOperations } from "./cart-operations.js";

/**
 * Builds a fresh `McpServer` with all tools/resources/prompts registered.
 *
 * `createMcpHandler` is stateless: a new server is created per request so
 * responses cannot leak between clients. The request graph resolves the
 * authenticated shopper id while it is built; token access remains lazy in
 * the Kroger client callback through `getMcpAuthContext()` (populated by
 * `OAuthProvider` and wrapped in the handler's AsyncLocalStorage).
 * Cart retry receipts are scoped by the authenticated OAuth client rather
 * than MCP transport state, so the server remains stateless at the protocol
 * layer.
 */
function buildServer(env: AppEnv, requestContext: McpRequestContext) {
  const container = createRequestContainer(env, requestContext);
  const server = registerRequestFeatures(container);

  // Prompts and the unified view resource are stateless registrations. The
  // feature graph above remains request-scoped and owns all user data access.
  registerPrompts(server);
  registerViewResource(server, () => env, APP_VIEW_URI, "mcp-app.html");
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

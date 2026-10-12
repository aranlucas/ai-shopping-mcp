import * as Sentry from "@sentry/cloudflare";
import { exports } from "cloudflare:workers";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { createMcpProtectedRequestHandler } from "@better-auth/mcp";
import {
  createResourceServerChallenge,
  metadataResponse,
} from "@better-auth/oauth-provider";
import { parseAccessTokenAuthorization } from "better-auth/oauth2";
import { APIError } from "better-call";

import type { AppEnv } from "./env.js";
import { buildServer, SERVER_INFO } from "./composition.js";
import {
  authSettings,
  accessTokenOptions,
  shoppingIdentity,
} from "./services/better-auth.js";
import { KrogerWorker } from "./kroger-handler.js";
import { registerConnectKroger } from "./tools/connect-kroger.js";

export { CartOperations } from "./cart-operations.js";

export { KrogerConnections } from "./kroger-connections.js";

export { LoginTransactions } from "./login-transactions.js";

function invalidIdentity(resource: string) {
  const challenge = createResourceServerChallenge(
    new APIError("UNAUTHORIZED", { message: "Invalid shopping identity" }),
    resource,
    { challengeScopes: ["mcp:tools"] },
  );

  if (!challenge) throw new Error("Unable to build authentication challenge");

  return Response.json(
    {
      jsonrpc: "2.0",
      error: { code: -32000, message: challenge.message },
      id: null,
    },
    { status: challenge.statusCode, headers: challenge.headers },
  );
}

async function mcpApiHandler(
  request: Request,
  env: AppEnv,
  ctx: ExecutionContext,
) {
  const options = accessTokenOptions(env, env.MCP_RESOURCE_URL);

  const protectedHandler = createMcpProtectedRequestHandler(
    {
      issuer: options.verifyOptions.issuer,
      audience: options.verifyOptions.audience,
      jwksUrl: options.jwksUrl,
      jwtVerifyOptions: options.verifyOptions,
      requiredScopes: options.requiredScopes,
    },
    async (verifiedRequest, claims) => {
      const identity = shoppingIdentity(options.verifyOptions.issuer, claims);

      const authorization = parseAccessTokenAuthorization(
        verifiedRequest.headers.get("Authorization"),
      );

      if (!identity || !authorization?.token)
        return invalidIdentity(env.MCP_RESOURCE_URL);

      const connection = await exports.KrogerConnections.getByName(
        identity.props.id,
      ).getToken();

      const props = {
        id: identity.props.id,
        ...(connection.status === "connected" ? connection.token : undefined),
      };

      const handler = createMcpHandler(
        (requestContext) => {
          const server =
            connection.status === "connected"
              ? buildServer(env, requestContext, (promise) =>
                  ctx.waitUntil(promise),
                )
              : new McpServer(SERVER_INFO, {
                  instructions:
                    "The user must connect Kroger before shopping. Call connect_kroger and ask them to open the returned URL, then retry after they finish.",
                });

          registerConnectKroger(
            server,
            env.MCP_RESOURCE_URL,
            connection.status,
          );

          return server;
        },
        { route: "/mcp", authContext: { props } },
      );

      return handler.fetch(verifiedRequest, {
        authInfo: {
          token: authorization.token,
          clientId: identity.clientId,
          scopes: identity.scope,
          expiresAt: identity.expiresAt,
          resource: new URL(env.MCP_RESOURCE_URL),
        },
      });
    },
  );

  return protectedHandler(request);
}

function withMcpCors(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
  );
  headers.set("Access-Control-Expose-Headers", "WWW-Authenticate");

  return new Response(response.body, { status: response.status, headers });
}

/** Better Auth owns OAuth issuance; this Worker only validates resource tokens. */
export async function handleRequest(
  request: Request,
  env: AppEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const path = new URL(request.url).pathname;

  if (
    path === "/.well-known/oauth-protected-resource" ||
    path === "/.well-known/oauth-protected-resource/mcp"
  ) {
    const settings = authSettings(env);

    if (request.method === "OPTIONS") return withMcpCors(new Response(null));

    if (request.method !== "GET")
      return withMcpCors(
        new Response(null, { status: 405, headers: { Allow: "GET, OPTIONS" } }),
      );

    return withMcpCors(
      metadataResponse({
        resource: env.MCP_RESOURCE_URL,
        authorization_servers: [settings.issuer],
        scopes_supported: ["mcp:tools"],
        bearer_methods_supported: ["header"],
      }),
    );
  }

  if (path === "/mcp") {
    if (request.method === "OPTIONS") return withMcpCors(new Response(null));

    return withMcpCors(await mcpApiHandler(request, env, ctx));
  }

  return KrogerWorker.fetch(request, env, ctx);
}

export default Sentry.withSentry(
  (env: AppEnv) => ({ dsn: env.SENTRY_DSN, enabled: Boolean(env.SENTRY_DSN) }),
  {
    async fetch(request: Request, env: AppEnv, ctx: ExecutionContext) {
      try {
        return await handleRequest(request, env, ctx);
      } catch (error) {
        Sentry.captureException(error);

        return Response.json({ error: "service_unavailable" }, { status: 503 });
      }
    },
  } satisfies ExportedHandler<AppEnv>,
);

import * as Sentry from "@sentry/cloudflare";
import { hostHeaderValidationResponse } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { createMcpProtectedRequestHandler } from "@better-auth/mcp";
import { createResourceServerChallenge, metadataResponse } from "@better-auth/oauth-provider";
import { parseAccessTokenAuthorization } from "better-auth/oauth2";
import { APIError } from "better-call";

import type { AppEnv } from "./env.js";
import { buildServer } from "./composition.js";
import { krogerToken } from "./services/kroger-token.js";
import {
  authSettings,
  accessTokenOptions,
  shoppingIdentity,
  mcpSettings,
} from "./services/better-auth.js";

function invalidIdentity(resource: string) {
  const challenge = createResourceServerChallenge(
    new APIError("UNAUTHORIZED", { message: "Invalid shopping identity" }),
    resource,
    { challengeScopes: ["mcp:tools"] },
  );

  if (!challenge) {
    throw new Error("Unable to build authentication challenge");
  }

  return Response.json(
    {
      jsonrpc: "2.0",
      error: { code: -32000, message: challenge.message },
      id: null,
    },
    { status: challenge.statusCode, headers: challenge.headers },
  );
}

async function mcpApiHandler(request: Request, env: AppEnv, ctx: ExecutionContext) {
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

      if (!identity || !authorization?.token) {
        return invalidIdentity(env.MCP_RESOURCE_URL);
      }

      const token = await krogerToken(env, identity.props.subject);

      if (!token) {
        return invalidIdentity(env.MCP_RESOURCE_URL);
      }

      const props = { id: identity.props.id, ...token };

      const handler = createMcpHandler(
        (requestContext) => buildServer(env, requestContext, (promise) => ctx.waitUntil(promise)),
        {
          route: "/mcp",
          authContext: { props },
          legacy: "reject",
          allowedHostnames: [new URL(env.MCP_RESOURCE_URL).hostname],
          allowedOriginHostnames: mcpSettings(env).allowedOrigins.map(
            (origin) => new URL(origin).hostname,
          ),
        },
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

function withMcpCors(response: Response, origin = "*", methods = "GET, OPTIONS") {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);

  if (origin !== "*") {
    headers.append("Vary", "Origin");
  }

  headers.set("Access-Control-Allow-Methods", methods);
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
  );
  headers.set("Access-Control-Expose-Headers", "WWW-Authenticate");

  return new Response(response.body, { status: response.status, headers });
}

/** Better Auth owns OAuth issuance; this Worker only validates resource tokens. */
async function handleRequest(
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
    const resource = mcpSettings(env).resource;

    if (request.method === "OPTIONS") {
      return withMcpCors(new Response(null));
    }

    if (request.method !== "GET") {
      return withMcpCors(new Response(null, { status: 405, headers: { Allow: "GET, OPTIONS" } }));
    }

    return withMcpCors(
      metadataResponse({
        resource,
        authorization_servers: [settings.issuer],
        scopes_supported: ["mcp:tools"],
        bearer_methods_supported: ["header"],
      }),
    );
  }

  if (path === "/mcp") {
    const settings = mcpSettings(env);
    const origin = request.headers.get("Origin");

    if (origin !== null && !settings.allowedOrigins.includes(origin)) {
      return new Response("Origin not allowed", { status: 403 });
    }

    const hostRejection = hostHeaderValidationResponse(request, [
      new URL(settings.resource).hostname,
    ]);

    if (hostRejection) {
      return hostRejection;
    }

    const corsOrigin = origin ?? new URL(settings.resource).origin;

    if (request.method === "OPTIONS") {
      return withMcpCors(new Response(null), corsOrigin, "POST, OPTIONS");
    }

    return withMcpCors(await mcpApiHandler(request, env, ctx), corsOrigin, "POST, OPTIONS");
  }

  if (path === "/") {
    return new Response("Shopping MCP: connect your AI client to /mcp and sign in to link Kroger.");
  }

  return new Response("Not found", { status: 404 });
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

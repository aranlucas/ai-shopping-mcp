import * as Sentry from "@sentry/cloudflare";
import { hostHeaderValidation } from "@modelcontextprotocol/hono";
import { createMcpHandler } from "agents/mcp/server";
import { createMcpProtectedRequestHandler } from "@better-auth/mcp";
import { createResourceServerChallenge, metadataResponse } from "@better-auth/oauth-provider";
import { parseAccessTokenAuthorization } from "better-auth/oauth2";
import { APIError } from "better-call";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";

import type { AppEnv } from "./env.js";
import { buildServer } from "./composition.js";
import { krogerToken } from "./services/kroger-token.js";
import {
  authSettings,
  accessTokenOptions,
  shoppingIdentity,
  mcpSettings,
} from "./services/better-auth.js";

type WorkerEnv = { Bindings: AppEnv };

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

/** Better Auth owns OAuth issuance; this Worker only validates resource tokens. */
export const app = new Hono<WorkerEnv>();

const metadataPaths = [
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
];

app.on("ALL", metadataPaths, cors({ allowMethods: ["GET", "HEAD", "OPTIONS"] }));

app.on("GET", metadataPaths, (c) => {
  const settings = authSettings(c.env);
  const resource = mcpSettings(c.env).resource;

  return metadataResponse({
    resource,
    authorization_servers: [settings.issuer],
    scopes_supported: ["mcp:tools"],
    bearer_methods_supported: ["header"],
  });
});

app.use("/mcp", async (c: Context<WorkerEnv, "/mcp">, next) => {
  const settings = mcpSettings(c.env);
  const origin = c.req.header("Origin");

  if (origin !== undefined && !settings.allowedOrigins.includes(origin)) {
    return c.text("Origin not allowed", 403);
  }

  // Use the SDK's Hono adapter with the hostname from this request's bindings.
  return hostHeaderValidation([new URL(settings.resource).hostname])(c, next);
});

app.use(
  "/mcp",
  cors({
    origin: (origin) => origin,
    allowMethods: ["POST", "OPTIONS"],
    exposeHeaders: ["WWW-Authenticate"],
  }),
);

app.post("/mcp", (c) => {
  const options = accessTokenOptions(c.env, c.env.MCP_RESOURCE_URL);

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
        return invalidIdentity(c.env.MCP_RESOURCE_URL);
      }

      const token = await krogerToken(c.env, identity.props.subject);

      if (!token) {
        return invalidIdentity(c.env.MCP_RESOURCE_URL);
      }

      const props = { id: identity.props.id, ...token };

      const handler = createMcpHandler(
        (requestContext) =>
          buildServer(c.env, requestContext, (promise) => c.executionCtx.waitUntil(promise)),
        {
          authContext: { props },
          legacy: "reject",
          allowedHostnames: [new URL(c.env.MCP_RESOURCE_URL).hostname],
          allowedOriginHostnames: mcpSettings(c.env).allowedOrigins.map(
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
          resource: new URL(c.env.MCP_RESOURCE_URL),
        },
      });
    },
  );

  return protectedHandler(c.req.raw);
});

app.get("/", (c) =>
  c.text("Shopping MCP: connect your AI client to /mcp and sign in to link Kroger."),
);

app.onError((error, c) => {
  Sentry.captureException(error);

  return c.json({ error: "service_unavailable" }, 503);
});

export default Sentry.withSentry(
  (env: AppEnv) => ({ dsn: env.SENTRY_DSN, enabled: Boolean(env.SENTRY_DSN) }),
  { fetch: app.fetch } satisfies ExportedHandler<AppEnv>,
);

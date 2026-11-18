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

const INVALID_ACCESS_TOKEN = "The MCP access token is invalid or expired.";
const RECONNECT_KROGER = "Sign in again to reconnect Kroger.";

function withInvalidTokenChallenge(response: Response, description: string): Response {
  const challenge = response.headers.get("WWW-Authenticate");

  if (
    response.status === 401 &&
    challenge?.startsWith("Bearer ") &&
    !challenge.includes('error="')
  ) {
    response.headers.set(
      "WWW-Authenticate",
      `${challenge}, error="invalid_token", error_description="${description}"`,
    );
  }

  return response;
}

function unauthorized(resource: string, message: string) {
  const challenge = createResourceServerChallenge(
    new APIError("UNAUTHORIZED", { message }),
    resource,
    { challengeScopes: ["mcp:tools"] },
  );

  if (!challenge) {
    throw new Error("Unable to build authentication challenge");
  }

  return withInvalidTokenChallenge(
    Response.json(
      {
        jsonrpc: "2.0",
        error: { code: -32000, message: challenge.message },
        id: null,
      },
      { status: challenge.statusCode, headers: challenge.headers },
    ),
    message,
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

app.post("/mcp", async (c) => {
  const resource = c.env.MCP_RESOURCE_URL;
  const options = accessTokenOptions(c.env, resource);
  const authorization = parseAccessTokenAuthorization(c.req.header("Authorization"));

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

      if (!identity || !authorization?.token) {
        return unauthorized(resource, INVALID_ACCESS_TOKEN);
      }

      const token = await krogerToken(c.env, identity.props.subject);

      if (!token) {
        return unauthorized(resource, RECONNECT_KROGER);
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

  const response = await protectedHandler(c.req.raw);

  // Better Auth supplies discovery for a 401, but does not distinguish a rejected bearer token.
  return authorization?.scheme === "Bearer" && authorization.token
    ? withInvalidTokenChallenge(response, INVALID_ACCESS_TOKEN)
    : response;
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

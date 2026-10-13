import { verifyBearerToken } from "better-auth/oauth2";
import type { JWTPayload } from "jose";
import { z } from "zod/v4";

export type AuthIdentity = { id: string; issuer: string; subject: string };

type AuthBindings = {
  BETTER_AUTH_ISSUER: string;
  BETTER_AUTH_JWKS_URL: string;
};

export function authIdentity(issuer: string, subject: string): AuthIdentity {
  return { id: JSON.stringify([issuer, subject]), issuer, subject };
}

const httpsUrl = z.url().refine((value) => {
  const url = new URL(value);

  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
  );
});

const settingsSchema = z.object({
  BETTER_AUTH_ISSUER: httpsUrl,
  BETTER_AUTH_JWKS_URL: httpsUrl,
});

export function authSettings(env: AuthBindings) {
  const parsed = settingsSchema.parse(env);

  return {
    issuer: parsed.BETTER_AUTH_ISSUER,
    jwksUrl: parsed.BETTER_AUTH_JWKS_URL,
  };
}

/** The resource identifier is the protected endpoint, not its host origin. */
export function mcpSettings(env: {
  MCP_RESOURCE_URL: string;
  MCP_ALLOWED_ORIGINS?: string;
}) {
  const resource = httpsUrl
    .refine((value) => new URL(value).pathname === "/mcp")
    .parse(env.MCP_RESOURCE_URL);

  const configuredOrigins = z
    .array(httpsUrl.refine((value) => new URL(value).origin === value))
    .parse(JSON.parse(env.MCP_ALLOWED_ORIGINS ?? "[]"));

  return {
    resource,
    allowedOrigins: [
      ...new Set([new URL(resource).origin, ...configuredOrigins]),
    ],
  };
}

const accessClaimsSchema = z.object({
  sub: z.string().min(1).max(256),
  client_id: z.string().min(1),
  scope: z.string(),
  exp: z.number().int().positive(),
  iat: z.number().int().nonnegative(),
});

export function accessTokenOptions(env: AuthBindings, resource: string) {
  const settings = authSettings(env);

  return {
    jwksUrl: settings.jwksUrl,
    verifyOptions: {
      issuer: settings.issuer,
      audience: resource,
      algorithms: ["EdDSA", "ES256", "RS256"],
      typ: "at+jwt",
      requiredClaims: ["sub", "client_id", "scope", "exp", "iat"],
    },
    requiredScopes: ["mcp:tools"],
  };
}

/** Map library-verified user claims into the shopping application's identity. */
export function shoppingIdentity(issuer: string, payload: JWTPayload) {
  const claims = accessClaimsSchema.safeParse(payload);

  if (
    !claims.success ||
    claims.data.iat > Math.floor(Date.now() / 1000) + 30 ||
    payload.cnf !== undefined
  )
    {return null;}

  return {
    props: authIdentity(issuer, claims.data.sub),
    clientId: claims.data.client_id,
    expiresAt: claims.data.exp,
    scope: claims.data.scope.split(" "),
  };
}

/** Verify a resource access token through Better Auth. */
export async function validateAccessToken(
  env: AuthBindings,
  resource: string,
  token: string,
) {
  const payload = await verifyBearerToken(
    token,
    accessTokenOptions(env, resource),
  );

  return shoppingIdentity(authSettings(env).issuer, payload);
}

import {
  authorizationCodeRequest,
  verifyBearerToken,
  verifyJwsAccessToken,
} from "better-auth/oauth2";
import type { JWTPayload } from "jose";
import { z } from "zod/v4";
import type { AppEnv } from "../env.js";

export { generateCodeChallenge as pkceChallenge } from "better-auth/oauth2";

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
    return null;

  return {
    props: authIdentity(issuer, claims.data.sub),
    clientId: claims.data.client_id,
    expiresAt: claims.data.exp,
    scope: claims.data.scope.split(" "),
  };
}

/** Browser linking accepts only a resource access token verified by Better Auth. */
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

const discoverySchema = z.object({
  issuer: z.string(),
  authorization_endpoint: httpsUrl,
  token_endpoint: httpsUrl,
  jwks_uri: httpsUrl,
  code_challenge_methods_supported: z.array(z.string()),
});

export async function discovery(env: AppEnv) {
  const settings = authSettings(env);

  const response = await fetch(
    `${settings.issuer.replace(/\/$/u, "")}/.well-known/openid-configuration`,
    {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!response.ok) throw new Error("Better Auth discovery unavailable");
  const metadata = discoverySchema.parse(await response.json());

  if (
    metadata.issuer !== settings.issuer ||
    metadata.jwks_uri !== settings.jwksUrl ||
    !metadata.code_challenge_methods_supported.includes("S256") ||
    [metadata.authorization_endpoint, metadata.token_endpoint].some(
      (url) => new URL(url).origin !== new URL(settings.issuer).origin,
    )
  )
    throw new Error("Better Auth discovery does not match configured issuer");

  return metadata;
}

export function browserClient(env: AppEnv) {
  return z
    .object({
      BETTER_AUTH_CLIENT_ID: z.string().min(1),
      BETTER_AUTH_CLIENT_SECRET: z.string().min(1),
    })
    .parse(env);
}

export type OidcTransaction = {
  type: "auth";
  verifier: string;
  nonce: string;
  redirectUri: string;
};

export async function exchangeIdentity(
  env: AppEnv,
  code: string,
  transaction: OidcTransaction,
) {
  const settings = authSettings(env);
  const client = browserClient(env);
  const metadata = await discovery(env);

  const tokenRequest = await authorizationCodeRequest({
    code,
    codeVerifier: transaction.verifier,
    redirectURI: transaction.redirectUri,
    options: {
      clientId: client.BETTER_AUTH_CLIENT_ID,
      clientSecret: client.BETTER_AUTH_CLIENT_SECRET,
    },
    tokenEndpoint: metadata.token_endpoint,
    tokenEndpointAuth: { method: "client_secret_basic" },
    resource: env.MCP_RESOURCE_URL,
  });

  const response = await fetch(metadata.token_endpoint, {
    method: "POST",
    redirect: "manual",
    headers: tokenRequest.headers,
    body: tokenRequest.body,
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) throw new Error("Better Auth code exchange failed");

  const tokens = z
    .object({ id_token: z.string(), access_token: z.string() })
    .parse(await response.json());

  const payload = await verifyJwsAccessToken(tokens.id_token, {
    jwksFetch: settings.jwksUrl,
    verifyOptions: {
      issuer: settings.issuer,
      audience: client.BETTER_AUTH_CLIENT_ID,
      algorithms: ["EdDSA", "ES256", "RS256"],
      requiredClaims: ["sub", "nonce", "exp", "iat"],
      maxTokenAge: "10m",
    },
  });

  const access = await validateAccessToken(
    env,
    env.MCP_RESOURCE_URL,
    tokens.access_token,
  );

  if (
    payload.nonce !== transaction.nonce ||
    !access ||
    access.clientId !== client.BETTER_AUTH_CLIENT_ID ||
    access.props.subject !== payload.sub ||
    !access.scope?.includes("mcp:tools") ||
    (payload.azp !== undefined &&
      payload.azp !== client.BETTER_AUTH_CLIENT_ID) ||
    (Array.isArray(payload.aud) &&
      payload.aud.length > 1 &&
      payload.azp !== client.BETTER_AUTH_CLIENT_ID)
  )
    throw new Error("Better Auth identity verification failed");

  return access.props;
}

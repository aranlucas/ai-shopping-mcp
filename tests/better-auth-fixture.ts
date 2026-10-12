import { exports } from "cloudflare:workers";
import { env } from "cloudflare:test";
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { authIdentity } from "../src/services/better-auth.js";

const signingKey = generateKeyPair("ES256", { extractable: true });

export async function fixtureJwks() {
  const { publicKey } = await signingKey;

  return {
    keys: [
      {
        ...(await exportJWK(publicKey)),
        kid: "fixture-key",
        alg: "ES256",
        use: "sig",
      },
    ],
  };
}

export async function fixtureToken(
  subject = "auth-user",
  claims: JWTPayload = {},
  typ = "at+jwt",
  kid = "fixture-key",
) {
  const { privateKey } = await signingKey;

  return new SignJWT({
    sub: subject,
    client_id: "mcp-client",
    scope: "mcp:tools",
    iss: env.BETTER_AUTH_ISSUER,
    aud: env.MCP_RESOURCE_URL,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  })
    .setProtectedHeader({ alg: "ES256", kid, typ })
    .sign(privateKey);
}

export async function seedKrogerConnection(
  subject = "auth-user",
  expiresAt = Date.now() + 1_800_000,
) {
  const identity = authIdentity(env.BETTER_AUTH_ISSUER, subject);
  await exports.KrogerConnections.getByName(identity.id).saveConnection({
    krogerId: "kroger-shopper",
    accessToken: "kroger-access-token",
    refreshToken: "kroger-refresh-token",
    tokenExpiresAt: expiresAt,
  });

  return identity;
}

export function fixtureDiscovery() {
  return {
    issuer: env.BETTER_AUTH_ISSUER,
    authorization_endpoint: `${env.BETTER_AUTH_ISSUER}/oauth2/authorize`,
    token_endpoint: `${env.BETTER_AUTH_ISSUER}/oauth2/token`,
    jwks_uri: env.BETTER_AUTH_JWKS_URL,
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
  };
}

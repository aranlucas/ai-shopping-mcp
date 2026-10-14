import { env } from "cloudflare:test";
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { authIdentity } from "@/services/better-auth.js";

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
  await env.AUTH.fetch("https://auth-stub/seed", {
    method: "POST",
    body: JSON.stringify({
      userId: subject,
      token: { accessToken: "kroger-access-token", expiresAt },
    }),
  });

  return identity;
}

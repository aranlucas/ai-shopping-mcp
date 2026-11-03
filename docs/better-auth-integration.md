# Shopping MCP integration with shared Better Auth

Shopping is a resource server. Shared Auth owns login, Kroger linking, consent, client registration, MCP token issuance and provider-token refresh. This keeps identity separate from Kroger authorization and avoids duplicating refresh coordination in shopping.

## Provider contract

[cloudflare.config.ts](../cloudflare.config.ts) defines the deployed resource settings; [the verifier](../src/services/better-auth.ts) defines accepted token claims. Package versions belong in `package.json`.

| Setting                 | Value                                                         |
| ----------------------- | ------------------------------------------------------------- |
| Issuer                  | `https://auth.aranlucas.workers.dev/api/auth`                 |
| JWKS                    | `https://auth.aranlucas.workers.dev/api/auth/jwks`            |
| Resource / JWT audience | `https://ai-meal-planner-mcp.aranlucas.workers.dev/mcp`       |
| Required scope          | `mcp:tools`                                                   |
| Kroger callback         | `https://auth.aranlucas.workers.dev/api/auth/callback/kroger` |
| Service binding         | `AUTH` → Worker `auth`, named entrypoint `KrogerTokens`       |

Use the exact HTTPS `/mcp` URI for `MCP_RESOURCE_URL`, provider resource registration, client resource requests and JWT audience. An origin-only audience is rejected. Auth must allow `mcp:tools` and link the MCP client to this resource. Client provisioning and authorization-server discovery are maintained in Auth; shopping publishes protected-resource metadata at `/.well-known/oauth-protected-resource/mcp` and a root alias.

Access tokens require an asymmetric signature (ES256, RS256 or EdDSA), `at+jwt` type, matching `iss`/`aud`, and `sub`, `client_id`, `scope`, `iat`, `exp` claims. The verified `sub` must be the Auth user ID used by the private RPC. ID tokens, opaque tokens, sender-constrained tokens and missing subjects are rejected. `mcp:tools` is an application scope, not a standard scope name.

Shopping data and Durable Object names use a stable serialization of `(issuer, subject)`; OAuth client identity is separate and scopes cart journal entries. Local JWT verification observes expiry but does not provide immediate central-session revocation.

## Kroger RPC and recovery

Each authenticated MCP request calls the private [RPC](../src/services/auth-rpc.ts):

```ts
accessToken(userId: string): Promise<{
  accessToken: string;
  expiresAt: number; // Unix epoch milliseconds
} | null>
```

Auth owns serialization of Kroger reads/refreshes. Shopping stores no credentials and caches no token, so each request observes the current link. Refresh tokens stay in Auth; Kroger access tokens enter only request-local context. Never forward MCP tokens to Kroger.

| Result                                                    | Shopping behavior             | Recovery                                                                          |
| --------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------- |
| Invalid MCP token or missing Kroger link (`null`)         | 401 authentication challenge  | Sign in through Auth and link Kroger again.                                       |
| RPC exception, malformed response or expired Kroger token | 503 without a login challenge | Restore Auth service availability; do not treat an outage as an unlinked account. |
| Kroger auth error during a tool call                      | Actionable tool error         | Sign in again to reconnect Kroger.                                                |

The Auth deployment must expose `KrogerTokens`, provide the linking flow before consent and invalidate unusable links. Provider migrations and refresh internals belong to the Auth repository; consult its [OAuth contract](https://github.com/sidequest-labs/auth/blob/4d4bae4297c1a042577380d21e74b10949428820/docs/oauth.md) for the historical integration baseline, and use Auth's current instructions for deployment.

## Token exchange

An exchanged token needs the same verified user, exact resource audience and `mcp:tools` scope. A changed `client_id` retains the user's shopping data while using that client's cart journal. Shopping needs no exchange endpoint or client secret to accept this JWT contract. Exchange does not replace the private Kroger RPC or grant shopping access to identity-only tokens. Provisioning, consent and exchange policy belong to Auth.

## Local configuration and release checks

Copy `.dev.vars.example` to `.dev.vars`. Run Auth with `KrogerTokens` available to the service binding, allow the local shopping resource `https://ai-shopping-mcp.localhost/mcp`, and register the callback URL on the Auth service with Kroger. The Kroger application needs `profile.compact`, `cart.basic:write` and `product.compact`. Kroger credentials belong to Auth.

`MCP_ALLOWED_ORIGINS` is a JSON array of exact HTTPS browser origins. The resource's own origin and requests without an Origin header are allowed. Unapproved origins receive 403, including preflight; Host validation uses the resource hostname. Legacy MCP initialization is rejected.

Before release, run the [repository validation](../README.md#validation). In an authorized live check, verify login when unlinked, successful shopping, and a 401 plus a linking step after Kroger unlinking. Fixture tests do not establish deployed Auth compatibility or successful real token exchange.

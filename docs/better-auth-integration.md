# Shopping MCP integration with shared Better Auth

The shopping Worker is a resource server. Better Auth owns MCP authorization, consent, client registration, token issuance, and MCP token refresh. There is no upstream identity bridge or fallback to the old Worker-issued tokens. The Worker uses `createMcpProtectedRequestHandler` from `@better-auth/mcp` for access-token verification, scope enforcement, and RFC 9728 challenges. The Cloudflare OAuth package is removed.

## Provider contract for the auth repository

The integration pins Better Auth and its MCP/OAuth packages to **1.7.7**, the latest release verified on October 12, 2026. Use the matching provider and JWT plugin in the auth repository. Configure:

| Setting                                 | Production value                                                  |
| --------------------------------------- | ----------------------------------------------------------------- |
| Exact issuer                            | `https://auth.aranlucas.workers.dev/api/auth`                     |
| JWKS                                    | `https://auth.aranlucas.workers.dev/api/auth/jwks`                |
| Resource / access-token audience        | `https://ai-meal-planner-mcp.aranlucas.workers.dev`               |
| Shopping scope                          | `mcp:tools`                                                       |
| Browser-linking callback                | `https://ai-meal-planner-mcp.aranlucas.workers.dev/auth/callback` |
| Kroger callback, registered with Kroger | `https://ai-meal-planner-mcp.aranlucas.workers.dev/callback`      |

Add the resource to `oauthProvider({ resources: [...] })` and add `mcp:tools` to the provider's allowed scopes alongside its existing OIDC scopes. Better Auth 1.7 uses `resources`; the older `validAudiences` option is not used. If the central service uses `mcp()` instead, set its `resource` to the same identifier; `mcp()` includes the OAuth provider, so do not also mount `oauthProvider()`. The resource is the configured origin, while the HTTP MCP endpoint is `/mcp`; audience verification uses the origin exactly. Discovery must advertise S256 PKCE and the configured issuer and JWKS URI.

Access tokens must be asymmetric JWTs with the `at+jwt` header type, containing `iss`, `aud`, `sub`, `client_id`, `scope`, `iat`, and `exp`. Better Auth verifies the signature, exact issuer, resource audience, expiry, and required claims, and enforces `mcp:tools` before entering the MCP handler. The shopping adapter maps the verified user and client into application context. ES256, RS256, and EdDSA are accepted. ID tokens, opaque tokens, tokens without a subject, old Worker tokens, and sender-constrained tokens are rejected. Keep this integration on ordinary Bearer tokens. Although the library supports DPoP, this application's policy rejects bound tokens; accepting them would also require a shared replay store across Worker instances.

Provision a confidential browser client through the auth service's official client API:

```json
{
  "client_name": "Shopping MCP — Kroger linking",
  "redirect_uris": [
    "https://ai-meal-planner-mcp.aranlucas.workers.dev/auth/callback"
  ],
  "scope": "openid mcp:tools",
  "resources": ["https://ai-meal-planner-mcp.aranlucas.workers.dev"],
  "grant_types": ["authorization_code"],
  "token_endpoint_auth_method": "client_secret_basic",
  "require_pkce": true,
  "dpop_bound_access_tokens": false,
  "subject_type": "public"
}
```

Set the returned ID in `BETTER_AUTH_CLIENT_ID` and store its secret as `BETTER_AUTH_CLIENT_SECRET` on the shopping Worker. The browser-linking client must return the same public subject in ID and access tokens; pairwise ID subjects are deliberately rejected. The browser flow requests the shopping resource with `openid mcp:tools`, so its resource access token is validated independently from its nonce-bound ID token.

MCP clients are separate clients of the central provider. Provision them centrally and configure their client IDs, or enable the provider's client-discovery mechanism appropriate to the supported clients. This Worker has no registration endpoint. Better Auth recommends CIMD for the current MCP profile; any CIMD transport and policy belongs in the auth repository. DCR is only enabled explicitly, using both registration controls, when supported clients require it. An OIDC-only scope/resource configuration is not sufficient for MCP onboarding.

## Worker configuration and deployment

Public runtime settings are `MCP_RESOURCE_URL`, `BETTER_AUTH_ISSUER`, `BETTER_AUTH_JWKS_URL`, and `BETTER_AUTH_CLIENT_ID`. Secrets are `BETTER_AUTH_CLIENT_SECRET`, `KROGER_CLIENT_ID`, and `KROGER_CLIENT_SECRET`; optional `SENTRY_DSN` enables error reporting. `COOKIE_ENCRYPTION_KEY` and `OAUTH_KV` are no longer used.

For local development, copy `.dev.vars.example` to `.dev.vars`, fill in credentials, and register these exact callbacks with the respective providers:

- Better Auth: `https://ai-shopping-mcp.localhost/auth/callback`
- Kroger: `https://ai-shopping-mcp.localhost/callback`
- Local resource audience: `https://ai-shopping-mcp.localhost`

Both token issuers and resource identifiers must use HTTPS. `cf` declares the new SQLite Durable Object classes `KrogerConnections` and `LoginTransactions`; no shopping D1 schema migration is added by this integration. Existing D1 setup/migrations are still required for shopping tools.

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build:worker` before deployment. The code change does not deploy or provision central clients automatically. Once the provider is configured, register this Worker in an MCP client, sign in through Better Auth, connect Kroger, and retry a shopping request.

## User flow and credential ownership

An authenticated user without a Kroger connection gets only `connect_kroger`. It returns the universal `/connect/kroger` browser URL. The user signs in to the same shared-auth account, follows the OIDC authorization-code flow with state, nonce and S256 PKCE, then approves Kroger's `profile.compact cart.basic:write product.compact` permissions. The callback verifies the real Kroger profile before persisting credentials. A successful connection exposes all shopping tools on subsequent requests; a client that caches the tool list may need to refresh it or reconnect.

Each redirect uses a ten-minute transaction in a Durable Object and a Secure, HttpOnly, SameSite=Lax `__Host-` cookie. State must be consumed atomically with the correct browser binding before any code exchange; replay and another browser's callback are refused. Transaction alarms remove abandoned state. Callback URLs are derived from the configured resource, never from request-supplied redirects.

One `KrogerConnections` object per verified `(issuer, subject)` stores the Kroger credentials in server-side Durable Object storage. It serializes refresh calls and persists a pending marker before contacting Kroger. A crash, network ambiguity, rejected refresh, or missing rotated refresh token requires reconnection; it never retries the old single-use refresh token. A user may reconnect the same Kroger shopper. Switching shoppers is refused to keep account history and cart journals associated with that shopper.

MCP JWTs contain identity and scope only. Kroger access tokens enter only the request-local server context; Kroger refresh tokens never enter the MCP auth context or client responses. MCP tokens are never forwarded to Kroger. The verified `client_id`, scopes, expiry, and resource are passed explicitly as SDK `AuthInfo`, separately from the shopping user props. Cart journaling retains the verified OAuth client ID separately from the auth user ID.

Browser linking also uses Better Auth's OAuth helpers: `createAuthorizationURL` builds the authorization URL and PKCE challenge, `authorizationCodeRequest` builds the authenticated code exchange, `verifyJwsAccessToken` verifies the ID token, and `verifyBearerToken` verifies the returned resource access token. The application retains browser binding, single-use state, nonce matching, and public-subject correlation.

Shopping data and Durable Object names now use a stable serialization of `(issuer, subject)`. Existing data keyed by Kroger IDs is not migrated, and old MCP grants are not accepted. No legacy database rows or KV namespaces are deleted by the code change. Local JWT verification observes token expiry; immediate central-session revocation would require introspection/current authorization checks beyond this integration.

## Sources

- [Better Auth remote MCP integration](https://better-auth.com/docs/plugins/mcp#remote-mcp-server)
- [Better Auth OAuth Provider](https://better-auth.com/docs/plugins/oauth-provider)
- [Better Auth 1.7 upgrade guide](https://better-auth.com/docs/guides/1-7-upgrade-guide)

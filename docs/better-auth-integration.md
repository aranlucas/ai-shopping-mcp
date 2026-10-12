# Shopping MCP integration with shared Better Auth

The shopping Worker is a resource server. Better Auth owns MCP authorization, consent, client registration, token issuance, and token refresh. It also links Kroger during MCP sign-in and stores the encrypted Kroger credentials. The shopping Worker uses `createMcpProtectedRequestHandler` from `@better-auth/mcp` for JWT verification, scope enforcement, and RFC 9728 challenges.

## Provider contract

This integration pins Better Auth and its MCP/OAuth packages to **1.7.7**. The production settings are:

| Setting                                 | Value                                                         |
| --------------------------------------- | ------------------------------------------------------------- |
| Issuer                                  | `https://auth.aranlucas.workers.dev/api/auth`                 |
| JWKS                                    | `https://auth.aranlucas.workers.dev/api/auth/jwks`            |
| Resource / JWT audience                 | `https://ai-meal-planner-mcp.aranlucas.workers.dev/mcp`       |
| Shopping scope                          | `mcp:tools`                                                   |
| Kroger callback, registered with Kroger | `https://auth.aranlucas.workers.dev/api/auth/callback/kroger` |
| Service binding                         | `AUTH` → Worker `auth`, named entrypoint `KrogerTokens`       |

The provider must allow `mcp:tools`, register the exact HTTPS `/mcp` resource, and link MCP clients to that resource. Dynamic registration is configured centrally in Auth. The shopping Worker has no registration or token endpoint. OAuth discovery must advertise the correct issuer, JWKS, and S256 PKCE.

Access tokens must be asymmetric JWTs with the `at+jwt` header type and `iss`, `aud`, `sub`, `client_id`, `scope`, `iat`, and `exp` claims. ES256, RS256, and EdDSA are accepted. The exact resource audience and `mcp:tools` scope are required. ID tokens, opaque tokens, missing subjects, and sender-constrained tokens are rejected. The verified `sub` must be the Auth user ID, because it is passed to the private token RPC.

## Login and recovery

The Auth provider's `postLogin` step sends MCP users without a linked Kroger account to `/connect-kroger`, before consent. That page uses Auth's Kroger linking flow and resumes `/oauth2/continue` after linking. Users complete one login flow through Auth and Kroger before receiving their MCP token.

For each authenticated MCP request, the shopping Worker calls `KrogerConnections.getToken(subject)` on the Durable Object named by the verified `(issuer, subject)`. The object serializes calls to `AUTH.accessToken(subject)`, preventing concurrent shopping requests from refreshing Kroger's single-use refresh token at the same time. Auth uses Better Auth's token accessor to refresh and persist credentials. The RPC contract is:

```ts
accessToken(userId: string): Promise<{
  accessToken: string;
  expiresAt: number; // Unix epoch milliseconds
} | null>
```

The shopping object stores no credentials and caches no token: the next request observes unlinking. Auth returns `null` for a missing or unusable link. The shopping Worker responds with a 401 authentication challenge, and the client signs in again. Auth removes unusable Kroger account rows; migration `0005` revokes that user's MCP grants when Kroger is unlinked, preventing silent MCP token refresh from bypassing the linking step. Apply that migration before deploying the Auth changes.

RPC errors and malformed or expired RPC token responses produce 503, without a re-login challenge. Auth service outages therefore do not masquerade as missing Kroger links. The shopping Worker has no `connect_kroger` tool, browser-linking client, `/connect/kroger`, `/auth/callback`, or `/callback` route. Kroger API failures during a tool call ask the user to sign in again.

Kroger access tokens enter only request-local shopping context. Refresh tokens remain in Auth and never enter MCP context or client responses. MCP tokens are never forwarded to Kroger. The SDK receives the verified OAuth client ID separately from the shopping user ID; cart journals retain both.

## Configuration and deployment

Public runtime settings are `MCP_RESOURCE_URL`, `BETTER_AUTH_ISSUER`, `BETTER_AUTH_JWKS_URL`, and `MCP_ALLOWED_ORIGINS`. `AUTH` binds to the `auth` Worker's `KrogerTokens` export. Kroger client ID and secret belong to Auth. The shopping Worker no longer needs `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET`, `BETTER_AUTH_CLIENT_ID`, or `BETTER_AUTH_CLIENT_SECRET`. `SENTRY_DSN` is optional.

For local development, copy `.dev.vars.example` to `.dev.vars`. Run the Auth Worker with its named `KrogerTokens` export available to the service binding. Configure Auth to allow the local shopping resource (`https://ai-shopping-mcp.localhost/mcp`) and register Kroger's callback on the local Auth service. Unit tests use an isolated test Auth worker with the same RPC signature.

`MCP_ALLOWED_ORIGINS` is a JSON array of exact HTTPS browser origins. The resource's own origin is always allowed; requests without an Origin header are also accepted. Other origins receive 403 even on preflight. Host validation uses the configured resource hostname. The MCP handler accepts 2026-07-28 requests and rejects legacy initialization.

Deploy Auth with migration `0005` and the `KrogerTokens` export first, then deploy the shopping Worker. `LoginTransactions` is declared deleted in the shopping `cf` config; `KrogerConnections` remains as the per-user token request coordinator. No shopping D1 migration is needed for this change. Existing shopping schema migrations remain required.

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build:worker` before deployment. Verify login redirects to Kroger when unlinked, then verify shopping through an MCP client. Removing the Kroger link must cause a 401 on the next request and a new linking step during login.

Shopping data and Durable Object names use a stable serialization of `(issuer, subject)`. Local JWT verification observes token expiry; it does not provide immediate central-session revocation. All callers of Auth's Kroger token accessor must respect the serialization contract; the shopping coordinator protects calls made through this Worker.

# MCP authorization specification review

Reviewed 2026-10-12 against the published MCP `2026-07-28` authorization specification, the earlier `2025-11-25` specification where useful, RFC 9728, RFC 8414, RFC 8707, RFC 9207, the v2 TypeScript SDK, and Better Auth 1.7.7's MCP/OAuth APIs.

## Implementation follow-up

The PR now uses the full `/mcp` resource identifier, points authorization challenges at its path-specific metadata document, validates browser response issuers against the transaction's recorded issuer and advertised capability before code exchange, and explicitly sets `legacy: "reject"`. Host validation and an exact browser-origin allowlist run before authentication and preflight; the Agents handler receives the same policy. Regression tests cover these changes, including origin-only JWT audience rejection and missing, mismatched, duplicate, and error-response issuers.

Provider resource/scope configuration, client provisioning, and optional CIMD onboarding remain owned by the auth repository. The original findings below describe the snapshot reviewed before these fixes; use [the integration contract](better-auth-integration.md) for the current configuration.

## Original review verdict

The architecture is a strong fit: the shopping Worker is an OAuth resource server, shared Better Auth is the authorization server, and the Worker validates audience-bound bearer tokens before constructing a request-scoped MCP server. The implementation follows the core MCP rule that a server accepts only tokens issued for its own resource. [MCP roles and token handling](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization), [token separation](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations).

Two issues remain before calling the tree a clean fit with the current specification:

1. `MCP_RESOURCE_URL` is the host origin, while the protected MCP endpoint is `/mcp`. The Worker returns the origin as `resource` from both the root and path-specific metadata routes. RFC 9728 requires the returned `resource` to match the identifier from which the metadata URL was derived. A client discovering `/.well-known/oauth-protected-resource/mcp`, or following a challenge for `/mcp`, can reject the metadata as mismatched. MCP permits an origin-only canonical URI, but recommends the most specific URI available; Better Auth's current MCP example uses `/mcp`.
2. `createMcpHandler` is called without `legacy: "reject"`. The installed Cloudflare Agents wrapper defaults to `legacy: "stateless"`, enabling a compatibility adapter for 2025-era traffic alongside `2026-07-28`. Set `legacy: "reject"` to make the current-only protocol policy explicit. This is a policy alignment item rather than an OAuth conformance failure. Evidence: `src/server.ts:102` and installed `agents@0.27.0`'s `handler-stateless-VvrWSAVA.js`.

The live authorization server also needs to advertise and enforce this Worker's resource and `mcp:tools` scope. Its current metadata advertises only OIDC scopes and no CIMD or DCR capability. That is provider configuration, not a failure in the Worker-side verifier.

## Requirement matrix

| Area                        | Current spec requirement                                                                                                          | Current tree                                                                                                            | Assessment                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Protected-resource metadata | MCP servers MUST publish RFC 9728 metadata with `authorization_servers`.                                                          | `src/server.ts` publishes resource, AS, scopes, and bearer-header metadata at root and `/mcp`.                          | Fits in principle; fix URI pairing.                                                                     |
| 401 discovery               | Server MUST expose metadata via `WWW-Authenticate` or a well-known URL.                                                           | Better Auth helpers produce `resource_metadata` challenges; both well-known forms are routed.                           | Fits subject to URI consistency.                                                                        |
| AS discovery                | AS MUST provide RFC 8414 or OIDC discovery; MCP clients MUST support both.                                                        | Auth exposes OAuth metadata and OIDC aliases. The fixed-provider browser linking client uses OIDC discovery only.       | Provider fits; the browser helper is not a general MCP discovery client.                                |
| Client registration         | Client MUST obtain an ID through pre-registration, CIMD, or DCR. CIMD is SHOULD; DCR is MAY and deprecated for compatibility.     | Worker has no registration endpoint; live auth has neither CIMD nor DCR advertised.                                     | Fits only for pre-registered clients. Enable CIMD for general MCP clients or document pre-registration. |
| Resource indicators         | Client MUST send `resource` in authorization and token requests; AS binds the token to it.                                        | Browser linking sends `resource` in both requests; Worker verifies exact audience.                                      | Fits once the canonical URI is consistent.                                                              |
| Token use                   | Bearer header is required; query tokens are forbidden; invalid/expired/wrong-audience tokens require 401.                         | Better Auth verifies signature, issuer, audience, expiry, and `mcp:tools`; token is never passed to Kroger.             | Fits. Extra JWT claims and DPoP rejection are application policy.                                       |
| Scope errors                | Insufficient scope SHOULD be 403 with `insufficient_scope`, required scopes, and metadata pointer.                                | Official Better Auth handler supplies this path.                                                                        | Fits. Auth provider must allow `mcp:tools`.                                                             |
| PKCE                        | Clients MUST use PKCE and S256 when capable; AS metadata must expose S256.                                                        | Browser flow uses S256 and rejects discovery without it.                                                                | Fits.                                                                                                   |
| Response `iss`              | If AS advertises `authorization_response_iss_parameter_supported`, client MUST validate form-response `iss` before code exchange. | `/auth/callback` checks state, nonce, ID-token issuer/audience/subject, and access-token binding, but not a form `iss`. | Conditional hardening gap; see below.                                                                   |

Matrix references: [discovery requirements](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery), [registration requirements](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration), [OAuth security requirements](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations), and [scope challenges and response validation](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).

## Resource URI and RFC 9728

RFC 9728 derives metadata URLs from the resource identifier. A host resource uses:

```text
https://host/.well-known/oauth-protected-resource
```

`https://host/mcp` uses:

```text
https://host/.well-known/oauth-protected-resource/mcp
```

The metadata `resource` MUST equal the identifier used to derive the URL. Section 3.3 also requires metadata obtained through a challenge to identify the URL used to request the resource. The current root response is internally consistent, but the `/mcp` response is not. A challenge that points to root while the client called `/mcp` also creates a mismatch for strict RFC validation. [RFC 9728 section 3.3](https://www.rfc-editor.org/rfc/rfc9728.html#section-3.3).

The safest alignment is to make the endpoint URI canonical:

```text
https://ai-meal-planner-mcp.aranlucas.workers.dev/mcp
```

Use that exact value for `MCP_RESOURCE_URL`, Better Auth `resources`, authorization/token `resource`, JWT `aud`, verifier audience, metadata `resource`, and client registrations. Retaining the origin and removing the path alias would not resolve the challenge-based mismatch. An origin URI is not intrinsically invalid: MCP lists both host and path URIs as valid, while recommending the most specific URI available. The recommendation here follows from the actual `/mcp` request URL and RFC validation rules. [MCP canonical server URI](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#canonical-server-uri).

## Registration and Better Auth

The fixed confidential client for the Worker's `/auth/callback` is sufficient for the Worker's browser-linking flow. It does not provision arbitrary MCP clients; those are separate OAuth clients of the central provider.

For unknown MCP clients, prefer Better Auth's CIMD support and select `metadataProfile: "mcp-2026-07-28"`. Compose the CIMD plugin and advertise `client_id_metadata_document_supported: true`. On Workers, inject a transport that resolves the hostname once, rejects special-use addresses, pins the approved connection address while preserving TLS identity, and refuses redirects. A DNS check followed by ordinary `fetch` is insufficient. [Better Auth CIMD profile and transport contract](https://better-auth.com/docs/plugins/cimd).

The shared auth service can retain `oauthProvider()` with `jwt()`; it does not need to switch to `mcp()`. Configure the resource and server-owned client-resource links through explicit provisioning or registration defaults. CIMD documents cannot grant themselves resource links. If using `mcp()` instead, it already includes the OAuth provider and adds its resource default; do not mount both provider plugins. [Better Auth resource policy](https://better-auth.com/docs/plugins/oauth-provider#resources), [MCP composition](https://better-auth.com/docs/plugins/mcp).

DCR is optional and deprecated in the current MCP specification. It is not needed solely for conformance and should be enabled only for a concrete client requirement. Pre-registration remains valid. [MCP client registration](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration).

The MCP authorization `iss` requirement applies directly to general MCP clients. The Worker callback is an OIDC linking client, not the MCP client used by a host, and the current provider metadata reports response-issuer support. Still, the callback should reject a present `iss` that differs from the recorded issuer and require it when the provider advertises the capability, before handling errors or exchanging a code. Save the validated issuer and capability alongside the transaction's PKCE verifier. [RFC 9207 response validation](https://www.rfc-editor.org/rfc/rfc9207.html#section-2.4), [MCP response validation](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#authorization-response-validation).

The repository imports `createMcpHandler` from Cloudflare's `agents/mcp/server` wrapper, which delegates protocol handling to the official v2 SDK and exposes the same `legacy` option. The wrapper also has Host and Origin allowlists; defaults cover `workers.dev` and localhost, while custom domains or browser origins hosted elsewhere need explicit configuration. Verify those allowlists rather than assuming the broad CORS header controls Origin validation. If moving to the official fetch handler directly, add its Host/Origin validation middleware.

## Recommended order

1. Choose the canonical resource, preferably the exact `/mcp` URI, and update auth and shopping configuration together.
2. Configure the provider with that resource and `mcp:tools`; confirm OAuth/OIDC discovery, S256 PKCE, grants, and client authentication methods.
3. Enable CIMD for unknown MCP clients, or document pre-registration. Add DCR only for a concrete compatibility need.
4. Set `legacy: "reject"` if current-only protocol support is intended.
5. Add pre-exchange response-issuer validation to browser linking.
6. Verify Host/Origin allowlists and run a real discovery, PKCE, code exchange, audience-bound token, insufficient-scope, and wrong-resource-token test.

JWT access tokens, the `at+jwt` type, this application's required `sub`/`client_id` claims, and rejecting DPoP are provider/application choices; MCP does not mandate this exact token representation. A single `mcp:tools` scope is also a product policy, not a standard scope name. Separate read/write scopes can be added if the product needs incremental consent. The resource metadata correctly omits `openid` and `offline_access`; those belong to authorization-server policy. [MCP token and refresh requirements](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization), [Better Auth protected-resource metadata](https://better-auth.com/docs/plugins/mcp#protected-resource-metadata).

## Sources

- [MCP Authorization, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [MCP Authorization, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728), [RFC 8414](https://www.rfc-editor.org/rfc/rfc8414), [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707), [RFC 9207](https://www.rfc-editor.org/rfc/rfc9207), [RFC 7591](https://www.rfc-editor.org/rfc/rfc7591)
- [OAuth Client ID Metadata Documents](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document-00)
- [MCP TypeScript SDK v2 authorization guide](https://ts.sdk.modelcontextprotocol.io/v2/serving/authorization)
- [MCP TypeScript SDK v2 `createMcpHandler`](https://ts.sdk.modelcontextprotocol.io/v2/api/%40modelcontextprotocol/server/server/createMcpHandler.html)
- [MCP TypeScript SDK v2 protocol versions](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions)
- [Better Auth MCP plugin](https://better-auth.com/docs/plugins/mcp) and [OAuth Provider](https://better-auth.com/docs/plugins/oauth-provider)

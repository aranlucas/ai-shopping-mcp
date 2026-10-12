# Better Auth as the shopping MCP identity provider

Research checked against official sources on October 12, 2026, before the decision to use the latest Better Auth release. The integration now implements the direct resource-server option through `@better-auth/mcp` **1.7.7**, without support for old issuer tokens. See [the implemented provider contract](better-auth-integration.md) for current configuration and behavior. The alternatives and earlier 1.6 version findings below remain historical research context.

## Two integration choices

**Keep the Cloudflare OAuth authorization server and use Better Auth for sign-in.** The Worker continues issuing MCP access and refresh tokens. Its authorization flow redirects to the auth service as a registered confidential OIDC client, verifies the upstream response, obtains a stable subject, and completes the original MCP authorization. Cloudflare documents upstream identity providers as a supported shape, with consent for each MCP client before the upstream redirect and browser-bound, single-use state. This preserves the present MCP token lifecycle while adding an independent app identity. [Cloudflare upstream sign-in](https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/upstream-sign-in.md)

**Make Better Auth the MCP authorization server.** The auth service owns MCP client registration, consent, codes, access tokens, and refresh tokens. The shopping Worker becomes a resource server. It publishes protected-resource metadata pointing to the auth service, verifies resource-bound access tokens, maps the verified subject to its shopping user, and performs tool authorization. This is the cleaner eventual architecture if the intent is to replace the Cloudflare OAuth issuer across multiple apps; it changes the MCP token contract and requires clients to reconnect.

Keeping the Cloudflare package does not necessarily mean keeping its issuer: its resource-only wrapper supports a custom JWT/JWKS or introspection validator for another issuer, returning validated application props and token metadata. The installed package version 1.2.3 exports `OAuthResourceServer` and includes this integration contract. [Cloudflare resource-server integration](https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/resource-servers.md)

## Choose the Better Auth version explicitly

The parent investigation found that `aranlucas/auth` pins Better Auth **1.6.25**, so current documentation is not a drop-in implementation guide. A matching `@better-auth/oauth-provider` **1.6.25** exists in the tagged upstream source. [Versioned package source](https://github.com/better-auth/better-auth/blob/v1.6.25/packages/oauth-provider/package.json)

For a migration staying on 1.6, the OAuth Provider documentation shows `jwt()` plus `oauthProvider()` from `@better-auth/oauth-provider`, login and consent pages, schema migration, discovery forwarding, optional DCR, PKCE, `validAudiences`, and remote resource verification through `verifyAccessToken` or `mcpHandler`. Set the actual MCP URL as the accepted audience and validate it explicitly in the Worker. Enable both DCR controls only if required by target clients. [Better Auth 1.6 OAuth Provider](https://better-auth.com/docs/1.6/plugins/oauth-provider)

For a planned 1.7 upgrade, account for schema and client-record changes: `resources` replaces `validAudiences`; the old in-core OIDC provider is removed; MCP helpers and options change. Check Better Auth Studio compatibility as part of that upgrade. [Better Auth 1.7 upgrade guide](https://better-auth.com/docs/guides/1-7-upgrade-guide)

## Current 1.7 integration capabilities

The OAuth Provider supports authorization code with S256 PKCE, public and confidential clients, OIDC identity claims, refresh tokens, JWT/JWKS verification, introspection, and resource-bound tokens. Discovery routes must reach the auth handler, including issuer-path aliases. Sending `resource` selects the JWT `aud`; the resource server must validate signature, issuer, audience, expiry, and operation scopes. `verifyAccessTokenRequest` also verifies DPoP-bound requests; serverless deployments need shared replay storage when accepting DPoP. Locally verified JWTs continue working until expiry after revocation, so immediate disconnection requires current authorization checks or introspection. [Current OAuth Provider](https://better-auth.com/docs/plugins/oauth-provider)

For current MCP integration, use `jwt()` and `mcp()` from `@better-auth/mcp`; `mcp()` already includes the provider, so do not also register `oauthProvider()`. Set one canonical HTTPS `resource`. For a separate Worker, `createMcpProtectedRequestHandler` accepts explicit `issuer`, `audience`, and `jwksUrl`, verifies access-token claims, and returns MCP-compatible 401/403 challenges. Publish RFC 9728 resource metadata on the Worker itself. DCR is an explicit fallback; the MCP 2026-07-28 profile prefers `@better-auth/cimd`. A Workers-hosted CIMD provider needs an appropriate SSRF-safe transport; the bundled Node transport is not portable to Workers. The documented profile uses SDK v2. [Current MCP integration](https://better-auth.com/docs/plugins/mcp)

`genericOAuth()` has the opposite role: it lets a Better Auth application authenticate through another OAuth/OIDC provider. It does not turn an email/password auth service into an authorization server. It could help link Kroger within the auth service, but that is a separate decision from issuing MCP tokens. [Generic OAuth](https://better-auth.com/docs/plugins/generic-oauth)

## Shopping-specific consequence

The recommended design inference is to keep app identity and Kroger authorization separate: stable auth-service subject → local shopping user → linked Kroger account and server-side Kroger credentials. MCP tokens grant shopping-tool access; Kroger tokens authorize Kroger API operations. Do not embed Kroger refresh tokens in a signed JWT or forward MCP tokens to Kroger. Existing users and preferences need a trusted account-link mapping before switching identity keys, and reconnection behavior should be tested with actual supported MCP clients.

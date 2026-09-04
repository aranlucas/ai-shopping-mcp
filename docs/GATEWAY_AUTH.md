# Gateway authentication

## Decision

The shopping MCP authenticates to `agents-gateway` with the MCP OAuth bearer
token that already authenticated the current MCP request. The gateway validates
that token against the shopping MCP `/userinfo` endpoint, resolves the returned
Kroger subject to the canonical D1 shopper, and installs that verified shopper
in the normal gateway identity context.

`SHOPPING_SERVICE_SECRET`, `x-shopping-service-secret`, and
`x-shopping-user-id` are removed.

## Why

The former shared secret duplicated an authentication relationship that already
exists:

1. The MCP host presents an OAuth bearer token to the shopping MCP.
2. The shopping MCP validates that token before invoking a tool.
3. The same bearer token can be presented to the gateway.
4. The gateway asks the token issuer's `/userinfo` endpoint for its verified
   Kroger subject.

This keeps the user identity non-forgeable without requiring a second
deployment secret shared between Cloudflare and Railway.

The gateway must never trust a caller-supplied Kroger subject header. Invalid,
expired, missing, oversized, or unverifiable bearer tokens fail closed with
`401`.

## Request flow

1. `OAuthProvider` validates the incoming MCP bearer token before invoking the
   MCP handler.
2. The request-local gateway client forwards that token as
   `Authorization: Bearer ...`, preferring `authInfo.token` when the runtime
   supplies it and otherwise using the authenticated request's strict Bearer
   header.
3. Gateway routing sends `/api/grocery/*` through the Kroger-token verifier;
   other routes continue to use the Clerk verifier.
4. The Kroger verifier calls the configured MCP origin's `/userinfo` endpoint
   with the bearer token.
5. The verifier validates the bounded JSON response, resolves `sub` through
   `ShoppingRepository.ResolveShopper`, and returns the canonical shopper
   identity.
6. Existing grocery authorization and D1 ownership checks run unchanged.

## Cart request state

MCP cart confirmations still require integrity-protected request state. Their
signing key is domain-separated from the already-required
`COOKIE_ENCRYPTION_KEY` by appending a fixed application label before it is
passed to `createRequestStateCodec`. This introduces no new runtime secret and
does not use the gateway bearer token as key material.

## Deployment order

Deploy the gateway first so it accepts MCP bearer tokens, then deploy the
shopping MCP so it stops sending the retired headers. After both deployments,
`SHOPPING_SERVICE_SECRET` can be removed from Railway and Cloudflare.

# Drop `requireAuth` — Trust OAuthProvider

**Date:** 2026-03-28

## Problem

Every authenticated tool file calls `requireAuth(ctx.getUser)` to obtain a `Result<Props, AppError>` before entering its neverthrow chain. This is defensive coding against a condition that cannot happen in production: `OAuthProvider` enforces authentication before any request reaches `MyMCP`, so `this.props` is always set when a tool handler runs. The check adds ceremony at every call site without providing real safety.

Additionally, `getUser` is a misleading name — it returns `Props` (token data), not a user object.

## Decision

Remove `requireAuth` entirely and rename `getUser` to `getProps` with a non-nullable return type. The OAuthProvider is the auth gate; tool handlers need not duplicate that check.

## Changes

### `src/tools/types.ts`

`ToolContext.getUser: () => Props | null` → `getProps: () => Props`

### `src/server.ts`

```ts
// Before
getUser: () => this.props ?? null,

// After
getProps: () => this.props!,
```

### Tool files (cart, location, inventory, shopping-list, recipes)

Replace the `requireAuth` wrapper with a direct call:

```ts
// Before
const result = requireAuth(ctx.getUser).asyncAndThen((props) =>
  safeResolveLocationId(ctx.storage, props.id, locationId).andThen(...)
);

// After
const props = ctx.getProps();
const result = safeResolveLocationId(ctx.storage, props.id, locationId).andThen(...);
```

### `src/tools/product.ts` and `src/tools/resources.ts`

`ctx.getUser()?.id` and `ctx.getUser()` → `ctx.getProps().id` / `ctx.getProps()`

### `src/utils/result.ts`

Delete the `requireAuth` export.

### `tests/utils/result.test.ts`

Delete the `requireAuth` test cases.

## What Does Not Change

- The neverthrow `Result` chain in each tool (`safeStorage`, `fromApiResponse`, `toMcpResponse`) is unchanged.
- `Props` type definition is unchanged.
- All other `ToolContext` fields are unchanged.
- No behavior change — the invariant is now expressed in the type rather than checked at runtime.

## Non-Goals

- Not switching to `getMcpAuthContext()` (would lose `Props` type safety via `Record<string, unknown>` cast).
- Not restructuring Props to use JWT claims shape.
- Not inlining tool registration into `MyMCP`.

## Implementation (2026-06-06)

The codebase had already migrated auth access from `ctx.getUser()` to the
module-level `getAuthProps()` helper (backed by `getMcpAuthContext()`) before
this spec was implemented, so the final shape differs slightly from the sketch
above while keeping the same intent:

- `src/utils/result.ts`: `getAuthProps(): Props | null` and `requireAuth` are
  replaced by a single `getProps(): Props`. It reads `getMcpAuthContext()` and
  returns a non-null `Props`, throwing only if called outside an authenticated
  MCP request — a condition `OAuthProvider` (`server.ts` `apiHandlers`) makes
  unreachable in production. The SDK types the context as
  `{ props: Record<string, unknown> }`, so `getProps` validates the field types
  and constructs a real `Props` rather than asserting `as Props`, resolving the
  `Record<string, unknown>` concern from the non-goals without an unchecked cast.
- Tool handlers (`cart`, `location`, `orders`, `recipes`, `shopping-list`) drop
  the `requireAuth(getAuthProps())` wrapper and call `const props = getProps()`
  directly. The `pantry`/`equipment` switch handlers return per-branch instead of
  routing through a single `toMcpResponse`, keeping each neverthrow chain intact.
- `src/tools/product.ts` and `src/tools/resources.ts` drop the `?.id` /
  null-guard branches (and the `unauthenticatedResource` helper) in favor of
  `getProps()`.
- Tests that exercised the now-unreachable unauthenticated path assert that
  `getProps()` throws instead of returning a graceful auth error.

## Follow-up (2026-06-09): complete the `createMcpHandler` switch

The 2026-06-06 implementation moved `getProps()` onto `getMcpAuthContext()`, but
`/mcp` was still wired to `MyMCP.serve("/mcp")` (the `McpAgent` Durable Object).
`getMcpAuthContext()` reads an AsyncLocalStorage that is **only** populated by
`createMcpHandler` (`runWithAuthContext`); the `McpAgent` path delivers auth as
`this.props` and never sets that ALS. So every handler that actually reached
`getProps()` threw "getProps() called outside an authenticated MCP request" in
production. (The OAuth integration test missed it because it always passed an
explicit `locationId`, the one branch that skips `getProps()`.)

Fix: `/mcp` now runs through stateless `createMcpHandler` with a per-request
`McpServer` factory (`buildServer`). Auth flows through `getMcpAuthContext()` as
the design intended — no tool/`result.ts` changes needed. Session scoping is
preserved by handing the transport a `storage` shim that rebuilds the minimal
`TransportState` from the client's `Mcp-Session-Id` header, so non-initialize
requests validate without server-side state. The `MyMCP` Durable Object (class,
binding, `new_sqlite_classes` migration) is removed via a `deleted_classes`
migration. The regression test exercises `getProps()` end-to-end (a tool call
with no `locationId` plus a resource read).

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

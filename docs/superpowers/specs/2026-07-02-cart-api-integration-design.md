# Cart API Integration — Design

**Date:** 2026-07-02
**Status:** Approved
**Source discovery:** `docs/cart-api-plan.md`

## Problem

`docs/cart-api-plan.md` documents newly discovered Kroger cart API surfaces. The
Partner Cart API's `GET /v1/carts/{id}` works with our existing
`cart.basic:write` OAuth token and returns real cart contents with product
descriptions — making `view_cart`'s current "the Kroger API has no cart-read
endpoint" premise obsolete.

Separately, a prior session already replaced `kroger/cart.json` with the
Partner Cart spec and regenerated `src/services/kroger/cart.d.ts`. That removed
the Public `PUT /v1/cart/add` path from the generated types, so the worker no
longer typechecks (5 errors in `src/tools/cart.ts` and
`tests/services/kroger/client.test.ts`).

## Decisions

| Decision              | Choice                                                                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope                 | Cart APIs only. Catalog V2 (`kroger/catalog.json`) stays spec-only, unwired.                                                                                                      |
| Atlas API             | **Out of scope entirely** — no module, no types, no calls.                                                                                                                        |
| Spec layout           | One merged `kroger/cart.json`: Partner endpoints + restored Public `PUT /v1/cart/add`. One `cartClient`.                                                                          |
| `view_cart`           | Live read via Partner `GET /v1/carts/{id}` when a cart ID is known; KV mirror fallback otherwise. Never a hard failure.                                                           |
| Cart ID discovery     | None automatic (Partner `GET /v1/carts` 403s; `PUT /v1/cart/add` returns 204 with no body). The ID is supplied once via an optional `cartId` input and remembered per user in KV. |
| New write tools       | None. `add_shopping_list_to_cart` stays on the proven Public `PUT /v1/cart/add`. Partner writes 403 with our scope.                                                               |
| Cart response caching | None. `cartClient` remains excluded from the shared Kroger KV response cache (user-scoped data). Only the cart _ID_ is stored, under a user-scoped key.                           |

## Design

### 1. Spec merge (fixes the typecheck)

Merge the Public Cart API's `PUT /v1/cart/add` path and its schemas
(`cart.cartItemModel`, `cart.cartItemRequestModel`) back into `kroger/cart.json`
alongside the Partner endpoints already there (`/v1/carts`, `/v1/carts/{id}`,
`/v1/carts/{id}/items`, `/v1/carts/{id}/items/{upc}`). Rerun
`pnpm generate:cart`.

Result: the 5 tsc errors disappear with **zero behavioral change** to
`add_shopping_list_to_cart`. One spec, one generated types file, one
`cartClient`; auth middleware untouched.

### 2. `CartIdStorage` (new, `src/utils/user-storage.ts`)

Small storage class following the existing siblings:

- Key: `user:{userId}:kroger-cart-id`
- API: `get(userId): Promise<string | null>`, `set(userId, cartId): Promise<void>`
- Registered in `ctx.storage` alongside `cartMirror` etc.

### 3. `view_cart` upgrade (`src/tools/cart.ts`)

Input schema: `{ cartId?: string }` — trimmed UUID string, optional.

Resolution and flow:

1. Resolve ID: explicit `cartId` arg → `ctx.storage.cartId.get(userId)` → none.
2. If an ID resolved: `fromApiResponse(cartClient.GET("/v1/carts/{id}", ...))`.
   - **Success:** persist the ID via `CartIdStorage` (so future no-arg calls go
     live), format the live cart, return it.
   - **Failure:** fall back to the mirror (see below).
3. If no ID resolved: mirror fallback directly.

Live response format (compact markdown, existing conventions):

- Header line includes `cartId={id}` so a small model can extract and reuse it.
- One line per item: `- {description} x{quantity} | upc={upc} | {modality}`.
- Footer names the next tool (`add_shopping_list_to_cart` to add more items).

Mirror fallback format: current mirror output, plus:

- A note that this shows assistant-added items only and may not reflect the
  full cart.
- A hint that passing `cartId` unlocks live cart reads.
- When an **explicit** `cartId` arg failed the live read: say so and why
  (e.g. "cartId not found — it may be stale; call view_cart without arguments
  to use the assistant's mirror"), rather than silently substituting mirror
  data.

Metadata updates:

- Description rewritten: reads the live Kroger cart when a cart ID is known;
  otherwise shows the assistant-added mirror. The stale "Kroger API has no
  cart-read endpoint" claim is removed.
- `openWorldHint: true` (it now calls an external API); `readOnlyHint` and
  `idempotentHint` stay `true`.

`addLineItemsToCart`'s mirror-append stays as-is — the mirror is what makes the
fallback useful.

### 4. Documentation

Update `docs/cart-api-plan.md` with an outcome/status section recording what
was adopted (Partner read, merged spec, manual cart-ID bootstrap) and what was
deferred (Atlas, write tools, Catalog V2), so the open questions there don't
read as still open. Update `AGENTS.md`'s tool list/description for `view_cart`
if its one-liner there changes.

## Error handling

- All fallible paths through `neverthrow` (`fromApiResponse`, `safeStorage`);
  KV read/write failures for the cart ID are non-fatal (read failure → treat
  as no stored ID; write failure → log and continue).
- `view_cart` never hard-fails: every error path lands on the mirror fallback
  with actionable text. Error/fallback text names concrete recovery tools
  (small-model contract).

## Testing

`tests/tools/cart.test.ts` via `tool-test-harness`:

- Live read with explicit `cartId` arg (fixture Partner response) — output
  contains `cartId=`, item lines with `upc=`.
- Cart ID persisted after a successful live read; subsequent no-arg call uses
  the stored ID.
- No-arg call with no stored ID → mirror fallback with the live-read hint.
- Live read failure (404/500 fixture) → mirror fallback; explicit-arg case
  mentions the failed cartId.
- Existing `add_shopping_list_to_cart` and `/v1/cart/add` client tests pass
  unchanged (proof the spec merge is correct).

Verification: `pnpm build` (typecheck must be green again), `pnpm test`,
`pnpm eval:mcp` (view_cart text format changes touch the small-model contract).

## Out of scope / future work

- **Atlas API** (`www.qfc.com/atlas/v1`): the only automatic cart-ID discovery
  path; deferred due to Akamai browser-header fragility. Adding it later slots
  into step 1 of the `view_cart` resolution order without reshaping anything.
- **Partner app registration** for `cart.basic:rw` — the clean long-term path
  to remove/update cart tools.
- **Catalog V2**: `kroger/catalog.json` + generated types remain in-tree,
  unwired; incorporation is a separate design.

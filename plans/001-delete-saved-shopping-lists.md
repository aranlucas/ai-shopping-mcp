# Plan 001: Shoppers can delete a saved shopping list from the assistant or the app

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fae55db..HEAD -- src/utils/shopping-store.ts src/utils/d1-shopping-storage.ts src/tools/shopping-list.ts src/tools/tool-types.ts src/composition.ts views/shared/types.ts views/app/tool-calls.ts views/app/views/shopping-lists.tsx views/preview-app.tsx test/d1-shopping-storage.test.ts test/tools/list-views.test.ts test/tools/tool-test-harness.ts test/views/tool-calls.test.ts test/evals/mcp-agent-contract.test.ts README.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW–MED (first destructive list operation; must stay shopper-scoped)
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `fae55db`, 2026-11-11

## Why this matters

Saved shopping lists can be created, read and edited, but never removed. Every
`create_shopping_list` and every `prepare_meal_plan` adds a row forever. Weekly
use ("Tuesday dinner" every week) makes `get_shopping_list` with no arguments
return an ever-growing index (it has no `LIMIT`), and makes name lookups
increasingly ambiguous, so the assistant has to ask "which Tuesday dinner?".
The only cleanup today is removing items one by one, which leaves empty lists
behind. A shopper-scoped delete closes the one missing verb in the list CRUD
surface and is the smallest real step toward the "data lifecycle" open risk in
`IMPROVEMENTS.md` (which explicitly says no tool deletes shopper data).

## Current state

- `src/utils/shopping-store.ts:39-50` — `ShoppingListStore` contract: `create`,
  `get`, `list`, `addItems`, `updateItem`, `removeItem`. No delete.
- `src/utils/d1-shopping-storage.ts:342-410` — D1 implementation. Every query
  is scoped by `and(eq(shoppingLists.id, listId), eq(shoppingLists.userId, userId))`
  (see `getListRow`, lines ~122-127). `list()` (lines ~366-378) has no limit.
- `src/tools/shopping-list.ts` — registers `create_shopping_list`,
  `get_shopping_list`, `update_shopping_list` via `registerAppTool`. The
  index view is built by `shoppingListsViewResult(lists, text)` which returns
  `appResult("shopping_lists", { lists })`.
- `src/db/schema.ts:40-54` — `shopping_lists` table; `meal_plans.shopping_list_id`
  (line 63) is a plain text column, **not** a foreign key.
- `src/utils/d1-meal-plan-storage.ts:100-160` — `prepare` inserts the list in the
  same batch that marks the plan `prepared`; a prepared plan is immutable and
  is never re-prepared, so deleting its list does not recreate it.
- Cart receipts (`src/cart-operations.ts`) are keyed by listId inside the
  per-shopper Durable Object; list ids are random UUIDs and never reused, so a
  deleted id cannot collide with a future list.
- `test/evals/mcp-agent-contract.test.ts:68-90` — asserts the exact sorted tool
  name list; adding a tool must update it.
- `views/shared/types.ts:51-70` — `ToolCall` union the app may call.
- `views/app/views/shopping-lists.tsx` — index view; each `ListRow` has an
  `Open` `ActionButton`.
- `views/preview-app.tsx:~268-285` — simulated host answering `get_shopping_list`
  and `update_shopping_list` from fixtures.

Conventions to match:

- Adapters throw; tools wrap storage in `safeStorage(() => …, "<operation>")`
  and return `toMcpError(error)` (see `get_shopping_list` in
  `src/tools/shopping-list.ts`). Error messages name the operation and the
  recovery step: `notFoundError("No list with listId=X. Call get_shopping_list with no listId.")`.
- Views: use component variants (`variant="destructive"`), keep `className` for
  layout only (`@shadcn/lint` rules in `.oxlintrc.json`); no new function/object
  literals as JSX props (`react-perf` rules) — wrap handlers in `useCallback`.

## Commands you will need

| Purpose   | Command                                                | Expected on success |
| --------- | ------------------------------------------------------ | ------------------- |
| Types     | `pnpm cf-typegen` (once per fresh checkout)            | exit 0              |
| Typecheck | `pnpm typecheck`                                       | exit 0              |
| Lint      | `pnpm lint` and `pnpm fmt:check`                       | exit 0              |
| Views     | `pnpm build:views`                                     | exit 0              |
| Tests     | `pnpm test -- --maxWorkers=1 <files>` then `pnpm test` | all pass            |
| Worker    | `pnpm build:worker`                                    | exit 0              |

## Scope

**In scope**: the files in the drift check above.

**Out of scope**:

- Deleting meal plans, pantry, orders or "all my data" — the retention/erasure
  policy in `IMPROVEMENTS.md` must be defined first.
- Changing `meal_plans.shopping_list_id` or adding a foreign key / migration.
- Purging cart receipts for the deleted list in `CartOperations`.
- Bounding `list()` (separate plan 003).

## Steps

### Step 1: Storage contract and D1 implementation

Add to `ShoppingListStore`:

```ts
/** Deletes one of this shopper's lists; returns what was deleted, or null when no such list exists for this shopper. */
delete(listId: string): Promise<{ id: string; name: string } | null>;
```

Implement in `createD1ShoppingStore` with a single shopper-scoped
`db.delete(shoppingLists).where(and(eq(id), eq(userId))).returning({ id, name }).get()`
returning `row ?? null`. Add a stub to `test/tools/tool-test-harness.ts`'s
in-memory `shoppingList`.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: `delete_shopping_list` tool

In `registerShoppingListTools`, register `delete_shopping_list` with input
`{ listId }` (`deleteShoppingListInputSchema`), annotations
`readOnlyHint:false, destructiveHint:true, idempotentHint:true, openWorldHint:false`,
and the app view URI. Description must say: only after the shopper asks;
irreversible; does not change the Kroger cart; a prepared meal plan keeps its
status and does not recreate the list.

Handler: `safeStorage(() => shoppingList.delete(listId), "delete shopping list")`.
Null → `notFoundError` naming `get_shopping_list` as recovery and stating
nothing was deleted. Success → best-effort re-read of `list()`; return the
`shopping_lists` view with text `Deleted shopping list "<name>" (listId=<id>). N list(s) remain.`
If the re-read fails, return `textResult` with the deletion text (the delete
already committed). Export `DeleteShoppingListArgs` from `src/tools/tool-types.ts`.
Mention the tool in `SERVER_OPTIONS.instructions` briefly.

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: App action

- `views/shared/types.ts`: add `{ name: "delete_shopping_list"; arguments: DeleteShoppingListArgs }`.
- `views/app/tool-calls.ts`: `deleteShoppingList(app, listId)` using
  `callForView`, returning the `shopping_lists` lists array (throw a clear
  error when another view comes back).
- `views/app/views/shopping-lists.tsx`: each row gets **Delete**; the first
  click shows **Confirm delete** (destructive) and **Cancel**; confirming calls
  `deleteShoppingList` and replaces the view data with the remaining lists;
  failure shows the error and keeps the row.
- `views/preview-app.tsx`: answer `delete_shopping_list` by removing the list
  from a stateful copy of the `LISTS` fixture.

**Verify**: `pnpm typecheck && pnpm build:views && pnpm lint` → exit 0.

### Step 4: Docs

README "Shopping workflow": one sentence on `delete_shopping_list`.

## Test plan

- `test/d1-shopping-storage.test.ts`: deleting returns `{id,name}` and the list
  disappears from `get`/`list`; another shopper deleting the same id gets
  `null` and the owner's list survives; deleting again returns `null`.
- `test/tools/list-views.test.ts` (pattern: "returns the lists index view when
  called with no arguments"): success returns the `shopping_lists` view of the
  remaining lists and names the deleted list; a missing list is a not-found
  error that says nothing was deleted; a storage failure is an error result.
- `test/views/tool-calls.test.ts`: `deleteShoppingList` sends the
  `delete_shopping_list` call and returns the remaining lists; an error result
  rejects with its text.
- `test/evals/mcp-agent-contract.test.ts`: add `delete_shopping_list` to the
  sorted tool list and assert its destructive annotation.

## Done criteria

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm fmt:check`, `pnpm build:views`, `pnpm build:worker` exit 0
- [ ] `pnpm test` exits 0 including the new tests
- [ ] `grep -n "delete_shopping_list" test/evals/mcp-agent-contract.test.ts` matches
- [ ] No migration added (`git status migrations/` clean)

## STOP conditions

- The delete query cannot be scoped by both `id` and `userId` in one statement.
- `test/evals/token-budget.eval.test.ts` fails on the tools/list budget and
  the only fix is weakening its threshold.
- Any step appears to need a schema migration.

## Maintenance notes

- If household sharing lands (ROADMAP), deletion must become owner-only and
  members' access must be revoked, not just the row deleted.
- If a retention sweep or "delete all my data" tool lands, reuse
  `ShoppingListStore.delete` semantics (shopper-scoped, returns what changed).
- A prepared meal plan can reference a deleted list; its **Open list** action
  then shows the not-found recovery message. Revisit if plans gain "re-prepare".

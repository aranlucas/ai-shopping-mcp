# Plan 004: Shopper index reads return a bounded, newest-first page

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fae55db..HEAD -- src/utils/d1-shopping-storage.ts src/tools/shopping-list.ts src/tools/inventory.ts test/d1-shopping-storage.test.ts test/tools/list-views.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 001 (deletion gives shoppers a way to act on a truncated index)
- **Category**: perf
- **Planned at**: commit `fae55db`, 2026-11-11

## Why this matters

`shoppingList.list()` (`src/utils/d1-shopping-storage.ts`, the `list:` entry)
selects every list with no `LIMIT`, and `get_shopping_list {}` sends all of them
to the model and the app. Pantry and equipment selects (`selectPantry`,
`selectEquipment`) are also unbounded and feed `get_shopping_profile`. Meal
plans already cap at 50 (`src/utils/d1-meal-plan-storage.ts`, `list`). Stored
data only grows (retention is a documented open risk), so token cost and view
weight grow with every week of use.

## Steps

1. Add `.limit(50)` to `shoppingList.list()` (newest `updatedAt` first, as now)
   and return a `total` count (a separate `count()` query) so the tool can say
   "Showing 50 of N lists; open older ones by name or delete unused ones."
   Name lookup in `get_shopping_list` must still search all of the shopper's
   lists: do it in SQL (`lower(name) = ?`, then `instr(lower(name), ?) > 0`),
   not by filtering the truncated page.
2. Cap pantry/equipment reads used for model text at a few hundred rows with a
   truncation note (do not cap the D1 writes).
3. Tests in `test/d1-shopping-storage.test.ts` (55 lists → 50 returned, total 55)
   and `test/tools/list-views.test.ts` (truncation note; a name match beyond the
   first 50 still opens).

**Verify**: `pnpm typecheck && pnpm exec vitest run --maxWorkers=1 test/d1-shopping-storage.test.ts test/tools/list-views.test.ts` → all pass.

## Done criteria

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm fmt:check` exit 0; full `vitest --maxWorkers=1` passes

## STOP conditions

- `ShoppingListSummary`/app payload changes would break the `shopping_lists`
  view schema in `src/app-results.ts`; keep `lists` as-is and add an optional field.

## Maintenance notes

- If household sharing lands, the index query must include shared lists in the same bound.

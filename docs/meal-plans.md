# Saved meal plans

## Shopper outcome

Keep dinner decisions across conversations. A shopper can save three dinners, change one meal's servings, review the remaining ingredient needs, and prepare one reusable shopping list. The assistant proposes recipes; the server persists the shopper's choices. This release does not generate recipes itself or establish nutrition/allergy suitability.

The MCP App shows the saved meals and an ingredient review queue. **Save servings** changes one meal. **I have all …** confirms the displayed amount in the displayed recipe unit. **Review with assistant** requests product choices or a partial pantry allocation. **Prepare reviewed list** is enabled only after all current ingredients are reviewed. Opening the resulting list exposes the existing, separate cart action.

## Tool contracts

| Tool                | Input and result                                                                                                                                                                                                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_meal_plan`  | `name`, explicit eight-character `storeId`, `modality` (`PICKUP` default or `DELIVERY`), and 1–7 meals. Each meal has `name`, `baseServings`, `servings` (1–50), and up to 40 ingredients (`name`, positive `quantity`, `unit`). Returns durable plan/meal IDs, version and an MCP App view. |
| `get_meal_plan`     | `planId` returns the full saved plan. Omit it to list the 50 most recently updated plans for this shopper.                                                                                                                                                                                   |
| `update_meal_plan`  | `planId`, `expectedVersion`, and one `change`: `set_servings`, `replace_meal`, `add_meal`, `remove_meal`, `set_store`, or `review_ingredient`. Uses returned meal IDs for edits; add uses a new unique meal ID. Returns the updated plan/version.                                            |
| `prepare_meal_plan` | `planId` and `expectedVersion`. Requires a fully reviewed draft. Returns a prepared plan with `shoppingListId`, or no list ID when no purchases remain. Repeating preparation returns the same result, including retries with the original version.                                          |

Example ingredient review (use the actual returned ingredient key and version):

```json
{
  "planId": "plan_returned_id",
  "expectedVersion": 2,
  "change": {
    "type": "review_ingredient",
    "key": "[\"milk\",\"cup\"]",
    "pantryQuantity": 1,
    "choice": "buy",
    "product": {
      "upc": "0001111041700",
      "productName": "Kroger 2% Reduced Fat Milk",
      "packages": 1
    }
  }
}
```

The UPC/name above are illustrative; select a matching product from `search_products` at the plan's store. `pantry` requires coverage of the entire ingredient requirement. `exclude` requires a nonblank reason supplied by the shopper. Product price is optional and is an estimate from the selected search result, never a checkout total. The server records the current required quantity and store as the review basis; callers cannot supply that basis.

## Quantity and review rules

- Recipe amounts scale by `servings / baseServings`. Only exact ingredient-name/unit pairs, after trimming and case normalization, aggregate. `cup`, `cups`, grams, cans and packages are not converted or inferred to be equivalent.
- Pantry inventory currently has no units. Its counts are context, not automatic recipe deductions. Confirm allocations in recipe units. Planning does not consume inventory or reserve it against other plans.
- Buy choices require an explicit selected UPC, product name and integer package count from 1–999. Recipe amounts never become package counts automatically. Several ingredients selecting the same UPC combine their reviewed package counts; inconsistent names are rejected and inconsistent prices are omitted.
- A changed required total makes that ingredient's previous decision stale. A changed store makes buy decisions stale. Unrelated decisions remain saved. A stale allocation is shown as a previous suggestion and does not count toward current pantry coverage.
- Prepared plans cannot be edited. Their resulting shopping lists retain normal list-editing behavior and the reviewed store/modality. Existing cart receipts reject changed-content retries after a list was already added.
- The reviewed store is product-search context. Kroger's cart-add API does not accept a store ID and this feature does not change the shopper's Kroger checkout location. Confirm current availability, price, store and fulfillment in Kroger before checkout.

## Recovery and concurrency

Edits compare the version read by the shopper with the database version. A stale edit fails visibly; reload the saved plan before making another decision. Preparation claims that version and inserts its shopping list inside one native D1 transaction. Concurrent preparations and lost-response retries return the same saved list. A list-insert failure rolls back the claim. A concurrent edit either wins and prevents preparation, or loses to the prepared plan; no partial list is retained.

After an ambiguous create response, call `get_meal_plan` with no arguments and find the saved plan before creating another. Create is not idempotent. After an ambiguous update or prepare response, reload by plan ID. No plan operation calls Kroger or changes a cart. A later `add_shopping_list_to_cart` uses existing operation receipts and ambiguity handling; it rejects an explicit store/modality conflicting with the prepared list.

## Implementation and validation

- [`src/domain/meal-plan.ts`](../src/domain/meal-plan.ts): Zod contracts, quantity aggregation, change application, review validity and purchase projection.
- [`src/utils/d1-meal-plan-storage.ts`](../src/utils/d1-meal-plan-storage.ts): shopper-scoped persistence, version checks and transactional preparation using Drizzle/D1.
- [`src/tools/meal-plan.ts`](../src/tools/meal-plan.ts): four MCP tools, typed app payloads and actionable errors.
- [`views/app/views/meal-plan.tsx`](../views/app/views/meal-plan.tsx): saved-plan index, servings and ingredient review, reload and prepare actions. App wire calls reuse the native MCP Apps SDK.

No new dependency or custom setup/validation/maintenance script is needed. Schema changes use `pnpm db:generate` (Drizzle Kit); tests use existing Vitest Node/Cloudflare projects; the app uses the existing Vite build.

```sh
pnpm cf-typegen
pnpm lint
pnpm fmt:check
pnpm typecheck
pnpm build:views
pnpm test
pnpm build:worker
```

Retained regressions cover quantity and stale-review rules, shopper isolation, edit/preparation races, transaction rollback, the real MCP/Worker/D1 journey against fixture Kroger APIs, cart retry/fulfillment behavior, rendered review states and visible app-call failures. A live MCP-host browser and real Kroger shopping pilot remain release validation.

## Rollout and value check

Migration `0001_harsh_marvel_apes.sql` adds `meal_plans` and an optional `shopping_lists.fulfillment_json` column; existing rows remain valid. Apply through the existing `pnpm db:migrate:local`, then the authorized production D1 migration process before deploying the new Worker. This change does not itself run remote migrations or deploy. Roll back application code only after considering prepared lists: older versions do not enforce their stored fulfillment choice. Keep the additive schema and saved data rather than deleting plans during rollback.

Pilot five voluntary sessions. Record baseline and new time from meal request to reviewed list, unresolved ingredients, manual corrections, and return use the next week. Target four of five completing without developer assistance. Do not count fixture tests as completed customer shopping, and do not collect recipe content or credentials as telemetry. Time savings, retention and revenue impact are unmeasured until that pilot.

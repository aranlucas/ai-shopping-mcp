> Historical API review. As of 2026-09-30, `shop_for_items` is read-only and
> returns up to five eligible options per requested item. The calling agent chooses
> UPCs and uses the list/cart tools. The automatic matching and `addToCart`
> recommendations below describe the previous API.

# Tool surface review

A tool-by-tool review of the 18 MCP tools against Anthropic's
[Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents),
followed by a proposed consolidated structure. Evidence comes from the
`tools/list` payload the server actually sends, the agent eval
(`pnpm eval:agent`, see `tests/evals/README.md`), and the models' own
`TOOL FEEDBACK` in eval transcripts.

<!-- EVAL-RESULTS -->

## What the surface already does well

- **Workflow-first tools.** `shop_for_items` collapses search → pick → list →
  cart into one call, which is what the guide means by "tools that handle
  multi-step workflows" rather than wrapping each API endpoint.
- **Batching.** `search_products` takes `terms[]` and says "do not call once
  per item"; eval transcripts show every model batching correctly.
- **Regex-extractable ids.** `storeId=…`, `upc=…`, `listId=…`, `itemId=…` in
  `content[0].text` let even small models chain calls without JSON parsing.
- **Actionable next steps.** Responses name the next tool
  (`pass the UPCs above to create_shopping_list`), and errors name the
  recovery tool.
- **Idempotent cart retries** via `operationId`.

## Per-tool analysis

Legend: **Keep** as is · **Fix** (description/schema/output) · **Merge**
into another tool · **Split**.

### Stores

| Tool                  | Verdict     | Findings                                                                                                                                                                                                                                                                                                                                                   |
| --------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_stores`       | Fix → merge | `chain` defaults to `"QFC"`, so a user in Ohio or Texas gets zero Kroger stores unless the model thinks to override it; the description says "Kroger or QFC" but the default is not neutral. `limit` is `number` (should be `integer`) with max 200 — a token trap. Returns ids but not hours, forcing a second `get_store` call for "when does it close". |
| `get_store`           | Merge       | Only adds hours and departments to what `search_stores` already returns. Two tools for "find store" / "describe store" is endpoint-mirroring.                                                                                                                                                                                                              |
| `set_preferred_store` | Keep        | Clear, validated, idempotent.                                                                                                                                                                                                                                                                                                                              |

### Products

| Tool              | Verdict | Findings                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_products` | Fix     | Good batching contract. `includeLocation` defaults false, so "which aisle" needs the model to discover a flag; aisle output is verbose (`bay: 12 \| side: L \| shelf: 3 \| shelf position: 1` per product even when unneeded). Output uses `## term` Markdown headings — the project convention is plain `Label:` lines. `storeId` description ("Kroger store ID") differs from every other tool ("8-character storeId from search_stores"). |
| `get_product`     | Merge   | Single-UPC lookup is a subset of search; one `search_products({ upcs })` path would cover it and remove a tool choice.                                                                                                                                                                                                                                                                                                                       |

### Deals and meal planning

| Tool                        | Verdict | Findings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_weekly_deals`          | Fix     | `limit` defaults to 50 — expensive for a context the model then has to scan; 10–20 is enough for planning. `pageLimit` ("Print-ad fallback only: number of ad pages to parse") leaks an implementation detail the model cannot reason about. Warnings are forwarded verbatim, so internal fetch errors reach the model's context.                                                                                                                                                                                               |
| `get_meal_planning_context` | Merge   | Returns pantry, expiry, equipment, and recent purchases — the same data as `get_shopping_profile` plus optional deals. Two overlapping "read my household" tools make the choice ambiguous; eval models pick either one for "what should I use first". `idempotentHint: false` on a read-only tool is inaccurate. `numberOfMeals`, `mealType`, and `dietaryPreferences` are only echoed back in the response header; they don't change the data returned (the host writes the plan), so they add schema surface without effect. |

### Shopping lists and cart

| Tool                        | Verdict  | Findings                                                                                                                                                                                                                                                                                                |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shop_for_items`            | Fix      | Best tool on the surface. But `addToCart` is hard-wired to `PICKUP` — "have it delivered" cannot be expressed, so delivery requests silently land as pickup or force the model into a second path. Add `modality`.                                                                                      |
| `create_shopping_list`      | Keep/fix | Items have neither `upc` nor `productName` required, so `{}` is schema-valid. Enforce "one of" in the schema, not only in the handler.                                                                                                                                                                  |
| `get_shopping_list`         | Keep     | Name-or-id lookup and list-all mode are exactly what agents need.                                                                                                                                                                                                                                       |
| `add_shopping_list_items`   | Merge    | Fine alone, but together with `edit_shopping_list_item` it means "make milk 2, drop the cheese, check off bread" costs three `edit` calls (one item per call) plus a read.                                                                                                                              |
| `edit_shopping_list_item`   | Merge    | One item per call; `listId`/`itemId` have no descriptions (where does `itemId` come from? — `get_shopping_list`). `destructiveHint: true` for what is mostly a quantity/check edit.                                                                                                                     |
| `add_shopping_list_to_cart` | Fix      | `modality` has no description or default stated. `operationId` is well-documented. Name is long; "send list or UPCs to cart" is really `add_to_cart`.                                                                                                                                                   |
| `view_cart`                 | Fix      | Exposes internal concepts: "remembered cartId", "assistant-only mirror". The model cannot obtain a Kroger cart UUID, so `cartId` is effectively unusable. Describe what the user gets ("items this assistant added to your Kroger cart") and drop the parameter, or document where a cartId comes from. |

### Household (pantry, equipment, orders, profile)

| Tool                    | Verdict       | Findings                                                                                                                                                                                                                                                                           |
| ----------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_shopping_profile`  | Fix           | The right "call this first" tool, but it returns no `structuredContent` (every other read does), uses `##` headings, and has `idempotentHint: false` despite being a pure read.                                                                                                    |
| `add_to_inventory`      | Merge         | `inventory: "pantry" \| "equipment"` with "Pantry only"/"Equipment only" fields is two schemas in one. Acceptable, but it pairs with `remove_from_inventory` as two halves of one edit operation.                                                                                  |
| `remove_from_inventory` | Merge + guard | `all: true` wipes an entire inventory from the same tool that removes one egg. A mis-set boolean is unrecoverable; clearing should be its own explicit action (or require an elicitation confirm). "Used 6 eggs" requires knowing that `quantity` on _remove_ means "amount used". |
| `record_order`          | Fix           | Requires a 13-digit `upc` per item, so "I bought milk and eggs" forces a search round-trip first (eval: `log-purchase` always spends a `search_products` call). Accept `productName`-only items and resolve UPCs server-side when omitted.                                         |

## Cross-cutting issues

1. **Inconsistent parameter language.** `storeId` is described four different
   ways; `listId`/`itemId` are sometimes undocumented. The guide's advice is
   to describe parameters the way you'd brief a new hire — consistently.
2. **Annotations drift.** Read-only tools marked `idempotentHint: false`
   (`get_shopping_profile`, `get_meal_planning_context`); a mostly-benign edit
   tool marked destructive.
3. **Markdown headings in tool text** (`## milk`, `## Pantry`). They cost
   tokens and are a project anti-pattern for formatters; use `Label:` lines.
4. **Hidden defaults with user impact**: QFC chain, PICKUP-only shopping,
   50-deal pages.
5. **Namespacing.** Names like `get_product`, `view_cart`, `search_stores`
   are generic; with several commerce MCP servers connected, a `kroger_`
   prefix (or grouping by `store_`/`list_`/`pantry_`) reduces
   cross-server confusion. Test before adopting — the guide notes prefix vs
   suffix choices measurably change accuracy.

## Proposed structure (18 → 12 tools)

| New tool               | Replaces                                                    | Shape                                                                                                                                                                                                |
| ---------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `find_stores`          | `search_stores`, `get_store`                                | `{ zipCode?, storeId?, chain?: "any" \| "QFC" \| "KROGER" … }` — default `any`; returns hours inline for the top results                                                                             |
| `set_preferred_store`  | same                                                        | unchanged                                                                                                                                                                                            |
| `search_products`      | `search_products`, `get_product`                            | `{ terms?: string[], upcs?: string[], storeId?, detail?: "concise" \| "detailed" }` — `detailed` adds aisle/shelf; concise shows aisle only                                                          |
| `get_weekly_deals`     | same                                                        | `{ storeId?, limit? = 15 }` — drop `pageLimit`; summarize warnings                                                                                                                                   |
| `shop_for_items`       | same                                                        | add `modality?: "PICKUP" \| "DELIVERY"`                                                                                                                                                              |
| `create_shopping_list` | same                                                        | item schema requires `upc` or `productName`                                                                                                                                                          |
| `get_shopping_list`    | same                                                        | unchanged                                                                                                                                                                                            |
| `update_shopping_list` | `add_shopping_list_items`, `edit_shopping_list_item`        | `{ listId, add?: Item[], change?: [{ itemId, quantity?, checked?, notes?, productName? }], remove?: itemId[] }` — one call for a whole edit                                                          |
| `add_to_cart`          | `add_shopping_list_to_cart`                                 | same inputs; `modality` described with default                                                                                                                                                       |
| `view_cart`            | same                                                        | no `cartId`; plain description of what is shown                                                                                                                                                      |
| `get_shopping_profile` | `get_shopping_profile`, `get_meal_planning_context`         | `{ include?: ("deals" \| "expiring")[] }`; adds `structuredContent`; plain-text sections                                                                                                             |
| `update_household`     | `add_to_inventory`, `remove_from_inventory`, `record_order` | `{ pantry?: { add?, use?: [{ name, quantity? }], remove? }, equipment?: { add?, remove? }, order?: { items: [{ upc? , productName, quantity }] } }` — "clear all" stays out of the model-facing tool |

Why this shape:

- **Fewer, higher-level tools** with no two tools answering the same question
  (store lookup, household read, list edit each have exactly one home).
- **One call per user intent** for the common multi-edit requests the eval
  exercises (`edit-weekly-list`, `pantry-used-up`, `log-purchase`).
- **Response-format control** (`detail`) instead of separate "full" tools.

Keep `record_order` separate from `update_household` if order history must
stay append-only and auditable — the merge is the most debatable row.

## How to validate a change

1. `pnpm eval:agent` on the current surface → baseline in
   `eval-results/agent.json` (`pnpm eval:agent:report` to browse).
2. Apply one row of the proposal, rerun, compare train-task pass rate, tool
   calls per task, and tool errors. Read the failing transcripts.
3. Only after train improves, run the held-out (`[test]`) tasks to confirm it
   generalizes. Don't edit descriptions to fix a held-out failure directly.

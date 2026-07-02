# Small-Model Efficiency Plan

Goal: make this the most efficient grocery-shopping MCP backed by Kroger —
efficient meaning a small-context model (Haiku-class) completes real shopping
tasks in few tool calls, few tokens, and with no dead ends. This document is
the analysis and the sequenced plan; the measurement side lives in
`tests/evals/` (see `tests/evals/README.md`). Product-feature sequencing stays
in `docs/ROADMAP.md`; this plan covers the model-facing API and code health.

## 1. Where we stand (measured baseline, 2026-07)

Numbers from `EVAL_LOG=1 pnpm eval:mcp` (estimateTokens ≈ chars/4):

| Surface                                                                             | Estimated tokens   | Notes                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full tool list (14 tools)                                                           | **3,455**          | Largest: `add_shopping_list_to_cart` 311, `add_to_inventory` 307, `record_order` 303, `create_shopping_list` 303. Updated post-Phase-1 items 1-2: `create_shopping_list`/`add_to_inventory` trimmed from 335/320; `get_product`/`record_order` grew slightly from the `upc`/`productId` alias |
| Server instructions                                                                 | 187                | States the golden path                                                                                                                                                                                                                                                                        |
| `search_products` ×5 terms, content text                                            | 291                | Compact markdown with `upc=` lines                                                                                                                                                                                                                                                            |
| `search_products` ×5 terms, **structuredContent**                                   | **4,658**          | ~16× the text, but not model-facing: the consuming hosts strip `structuredContent` before it reaches the model (owner decision, 2026-07). It exists for the MCP Apps views; the eval cap only guards unbounded growth                                                                         |
| `search_stores` / `get_product` / `shop_for_items` / `get_shopping_profile` content | 74 / 40 / 102 / 61 | All healthy                                                                                                                                                                                                                                                                                   |

What already works well (worth protecting, which the evals now do):

- Workflow-first tool set (14 tools vs. the reference implementation's 26).
- Golden path completes in 4 calls; every hand-off id is printed in text as
  `key=value` and regex-extractable.
- Schemas normalize small-model mistakes (UPC padding, string quantities,
  lowercase modality, whitespace) instead of rejecting them.
- Errors name the recovery tool, and following the advice works.
- Cart add is retry-safe (cart snapshot short-circuits duplicate adds), and
  checkout is elicitation-confirmed with graceful fallback.
- Markdown (not TOON/JSON) in `content[0].text`; parallel bulk search with
  progress notifications.

## 2. What other grocery/commerce MCPs do (survey)

- **CupOfOwls/kroger-mcp** (reference implementation): 26 fine-grained tools
  (`list_chains`, `get_department_details`, `test_authentication`, …), local
  JSON-file cart mirror to work around Kroger's write-only cart API, preferred
  store persistence, and workflow prompts. Techniques worth stealing: the
  **local cart mirror** (view/remove/clear cart) and rate-limit awareness
  (Kroger caps: 10,000 product, 1,600 location, 5,000 cart calls/day). The
  26-tool surface itself is the anti-pattern this repo already avoided.
- **Instacart's official MCP**: just **two tools** (`create-recipe`,
  `create-shopping-list`) that return a handoff URL. Production commerce MCPs
  are converging on tiny surfaces with deep-link handoffs.
- **Shopify Storefront MCP**: ~3 tools (`search_shop_catalog` with
  natural-language queries, `update_cart` handling add/remove/update in one
  tool, policy Q&A), plus MCP-UI for rich components — the same
  `structuredContent`+view pattern this repo uses.
- **General MCP token-efficiency practice**: schema bloat and response bloat
  are the two costs; the fixes are response projection (trim fields the model
  never uses), aggregation tools over CRUD tools, and result caching. This
  repo already has the aggregation-tool shape (`shop_for_items`,
  `get_shopping_profile`), and response projection is a non-issue here because
  the consuming hosts strip `structuredContent` from model context.

Sources: github.com/CupOfOwls/kroger-mcp, docs.instacart.com
(developer_platform_api MCP tutorial), shopify.dev/docs/apps/build/storefront-mcp.

## 3. Improvement plan

Each item names its eval gate — the suite that must stay green (or get a new
case) when the change lands.

### Phase 1 — Token efficiency (highest leverage)

> Decision (2026-07): `structuredContent` stays as-is. The consuming hosts
> already strip it from model context before the model sees it, so slimming it
> buys no model-facing tokens — it exists for the MCP Apps views. The
> token-budget eval keeps a generous cap on it purely as a growth guard.

1. **DONE (2026-07). Trim the two heaviest tool definitions.**
   `create_shopping_list` (335t → 303t) and `add_to_inventory` (320t → 307t)
   spent tokens on prose the schema already encodes. Kept the JSON examples
   (they demonstrably help small models); cut redundant sentences from
   `description` and `.describe()` strings.
   _Gate:_ per-tool budget in `token-budget.eval.test.ts` tightened from 450
   to 400 (measured max is now 311, `add_shopping_list_to_cart`, unchanged).
2. **DONE (2026-07). Unify the UPC field name.** `get_product` took
   `productId` and `record_order` items took `productId`, but every
   model-facing string says `upc=`. Small models copy field names; the
   mismatch caused retries. Both tools now document `upc` as the primary
   field; `productId` is kept as a deprecated alias (object-level `.refine()`
   requiring at least one, `upc` wins if both are present) so existing hosts
   don't break. The KV `OrderRecord` shape is unchanged (`productId`
   internally); the tool boundary normalizes.
   _Gate:_ new `input-forgiveness` cases: `{upc: …}` accepted on both tools;
   `{productId: …}` alias still accepted on both.

### Phase 2 — Fewer round trips

3. **DONE (2026-07). Optional `addToCart` on `shop_for_items`.** For a
   returning user with a saved store, `shop_for_items {items, addToCart:
true}` reuses `add_shopping_list_to_cart`'s confirm-then-PUT path
   (`addLineItemsToCart`, exported from `src/tools/cart.ts`) to land the cart
   in the same call — one call instead of the documented two-step
   `shop_for_items` → `add_shopping_list_to_cart`. The elicitation
   confirmation still gates the write; a decline/cancel still returns the
   created list with a retry hint. The cart snapshot is persisted under the
   same storage key `add_shopping_list_to_cart` checks, so a follow-up call
   with the same `listId` short-circuits instead of double-adding. Kroger's
   5,000 cart-calls/day budget is untouched — it's the same single PUT.
   _Gate:_ new golden-path case asserting a 1-call cart landing plus a
   non-double-adding retry; existing 4-call golden path and retry-safety
   cases unchanged.
4. **DONE (2026-07). Local cart mirror + `view_cart`.** Kroger's API cannot
   read the cart (the reason IMPROVEMENTS.md defers view/remove/clear). Added
   `CartMirrorStorage` (`src/utils/user-storage.ts`), a per-user rolling
   mirror (7-day TTL, capped at 100 line items) appended to by every
   successful cart PUT — `add_shopping_list_to_cart` (both the listId and
   inline-items paths, via the shared `addLineItemsToCart`) and
   `shop_for_items`'s `addToCart` path. The read-only `view_cart` tool
   (registered with plain `ctx.server.registerTool`, no `structuredContent`/
   view, like `get_shopping_profile`) lists mirrored items and states plainly
   that it only shows items added through this assistant — in-store/app
   changes are invisible.
   _Gate:_ golden-path case: add → `view_cart` shows the item's name and upc;
   token budget stays under the tool-surface cap (measured: +134t for
   `view_cart`, total 3637t, cap 4200t).
5. **DONE (2026-07). KV-cache product searches (short TTL).**
   `searchProductsForTerms` (`src/tools/product.ts`) now checks
   `env.USER_DATA_KV` (guarded by the `isKvLike` pattern shared with
   `weekly-deals.ts`) before each per-term Kroger fetch, keyed on
   `products|v1|loc:{locationId}|limit:{limitPerTerm}|term:{term}` with a
   flat 10-minute `expirationTtl`. Empty results are cached too (a
   consistently-empty term shouldn't keep re-querying); failed searches are
   never cached. A cache hit still counts toward progress notifications, and
   searches stay parallel — shared by both `search_products` and
   `shop_for_items`.
   _Gate:_ existing suites stay green; unit tests cover the cache key, fresh
   hit (fetch skipped), miss (fetch happens), failed-search non-caching, and
   empty-result caching.

### Phase 3 — Efficiency features (ties into ROADMAP.md)

6. **Deal-aware and pantry-aware shopping** (ROADMAP #1/#2): flag `on sale`
   and `already in pantry` per line in `shop_for_items`/`create_shopping_list`
   output — one line-suffix each, so the token cost is a few words per item
   while saving the model separate `get_weekly_deals`/`get_shopping_profile`
   calls.
   _Gate:_ content budgets in `token-budget.eval.test.ts`; new scenario in
   `scenarios.ts` ("add whatever milk is on sale").
7. **Replenishment** (ROADMAP #3): once landed, add a live-model scenario
   ("what am I due to restock?") to keep its output small-model-parseable.

### Server-side AI (the unused `AI` binding)

`wrangler.jsonc` declares a Workers AI binding (`env.AI`) that no code uses.
Position: **no internal agents, but targeted single-shot inference is worth
it** in two places.

Keep the invariant that the host model is the only agent. MCP Sampling was
removed deliberately (AGENTS.md); an inner agent loop inside a tool would
reintroduce hidden multi-step reasoning with its latency, cost,
non-determinism, and debugging opacity — and it duplicates work the host model
already does with full conversation context (free-text list parsing, meal
planning). `get_meal_planning_context` stays a context provider.

What the AI binding _is_ a good fit for: single-shot, fallback-safe inference
where the current code uses a crude heuristic and the host model never sees
the candidates:

8. **Semantic match ranking in `shop_for_items`.** `pickBestMatch` currently
   takes the first pickup-available result of a keyword search, so "milk" can
   match a milk-chocolate bar. Rank the ≤5 candidates against the requested
   name with Workers AI embeddings (e.g. `@cf/baai/bge-small-en-v1.5`,
   cosine over name vs `description + brand + size`), cache product
   embeddings in KV keyed by UPC, and fall back to the current heuristic on
   any AI-binding error or timeout. One inference call per shop*for_items
   invocation, bounded latency, no change to the model-facing response shape.
   This is the highest-leverage quality fix for the tool small models depend
   on most — and the checkout elicitation still gates any wrong pick.
   \_Gate:* new adversarial fixture in `harness.ts` (a term whose first result
   is a wrong-category product) + a golden-path case asserting the right UPC
   lands in the cart; live-model scenarios stay green.
9. **Deal ↔ item fuzzy matching** (feeds item 6): scraped QFC deal titles are
   messy free text; embedding similarity beats string matching for tagging
   list items `on sale`. Same pattern: single-shot, KV-cached, heuristic
   fallback.
   _Gate:_ unit tests on the matcher; content budgets unchanged.

Both must degrade to today's behavior when `env.AI` errors, and tests/evals
run against the fallback path (no AI binding calls in CI) with the matcher
itself unit-tested behind an interface.

### Code health (independent of phases)

- **DONE (2026-07). Delete ~22 dead formatter exports.** Everything in
  `src/utils/format-response.ts` above the "MARKDOWN: model-facing formatters"
  banner except `formatPreferredLocationCompact`, `formatPantryListCompact`,
  `formatEquipmentListCompact`, `formatOrderHistoryCompact`, and
  `formatShoppingList(Item)Compact` had zero call sites in `src/` (verified by
  grep, 2026-07), including `formatPreferredLocation` (not previously listed,
  confirmed dead by the same grep): `formatProduct*`, `formatLocation*`,
  `formatWeeklyDeal*` (list variants), `formatPantryItem`/`formatPantryList`,
  `formatOrderRecord`/`formatOrderHistory`,
  `formatEquipmentItem`/`formatEquipmentList`,
  `formatShoppingList`/`formatShoppingListItem`, `formatPreferredLocation`.
  Removed them and their tests — the file dropped from 971 to 355 lines.
- **DONE (2026-07). `search_stores` chain default.** `chain` still defaults
  to `"QFC"` (unchanged behavior), but now has a `.describe()` saying so and
  naming `chain: "KROGER"` as the way to widen results.
- **DONE (2026-07). `IMPROVEMENTS.md` backlog hygiene.** The cart-mirror
  items now point at Phase 2 item 4 here instead of duplicating it; added a
  "Rejected" section for `test_authentication`, `get_authentication_info`,
  `get_user_profile`, `list_chains`, `list_departments`, and
  `force_reauthenticate` with per-tool reasoning — they add surface without
  serving any golden path, the trap the 26-tool reference fell into.
- **DONE (2026-07). Elicitation error-message coupling.**
  `requestCheckoutConfirmation` still string-matches the SDK's
  `"Client does not support form elicitation."` message (there is no
  `getClientCapabilities()`-based check exposed for this on the type this
  function accepts), but the string is now the exported
  `ELICITATION_UNSUPPORTED_MESSAGE` constant in `src/tools/shopping-list.ts`,
  and `tests/tools/shopping-list-confirmation.test.ts` asserts it against a
  real `Server#elicitInput` call from the installed SDK (no transport needed —
  a freshly constructed `Server` has no client capabilities, so the throw
  happens before any request is sent). An SDK upgrade that rewords the
  message now fails that test loudly instead of silently breaking checkout
  for no-elicitation clients.

## 4. Non-goals

- **Slimming `structuredContent`.** The consuming hosts strip it from model
  context; it is the MCP Apps view payload, not a model-facing cost.
- **Internal agents / sampling inside tools.** Single-shot AI-binding calls
  with heuristic fallback (items 8–9) are the ceiling; no multi-step loops,
  no server-side meal-plan generation, no re-introducing `createMessage`.
- **Growing the tool surface** toward chains/departments/auth-introspection
  parity with the reference implementation. Every added tool costs every
  request ~200–350 tokens; the survey shows production commerce MCPs are
  shrinking surfaces, not growing them.
- **Switching `content[0].text` back to structured formats** (TOON/JSON).
  Markdown `key=value` lines are the small-model contract; the evals encode
  it.
- **Per-tool auth gating or sequential product search** — explicitly
  protected by AGENTS.md and the agent-contract eval.

## 5. How to work with the evals

Every phase item lands with its eval gate updated in the same PR. Budgets in
`token-budget.eval.test.ts` are calibrated numbers, not aspirations: after a
deliberate change, re-measure with `EVAL_LOG=1 pnpm eval:mcp` and set the new
budget at ~1.3× measured. Before/after comparisons for model behavior come
from the live runner: `EVAL_LIVE=1 pnpm eval:mcp`, which drives a small model
through the Worker's own Cloudflare AI binding (default
`@cf/meta/llama-3.1-8b-instruct`, override with `EVAL_MODEL`).

# Code quality audit — 2026-09-18

Applied the thermo-nuclear-code-quality-review skill to the current working tree, including the recent cart-state and shopping-outcome refactors. This is a whole-codebase maintainability review, not just a review of the uncommitted diff. Findings below distinguish confirmed behavior from structural risks.

At the time of the audit, the approval bar was not met. The strongest opportunities were to make domain outcomes authoritative at their boundaries, remove parallel representations of the same facts, and stop testing handlers under contracts that production does not use. Replacing every `if` with a lookup table would not address these problems.

The inventory covered 52 source files, 32 view files, 58 test files, and four scripts, including generated declarations and UI primitives. Review depth focused on handwritten behavior, module boundaries, and representative tests for each subsystem. OAuth, API clients, cart persistence, catalog/selection, shopping storage, inventory, recipes, resources, views, and test infrastructure were inspected. Historical design documents and generated schemas were used as context, not treated as handwritten implementation.

No handwritten production file exceeds 1,000 lines. The largest is `src/services/qfc-weekly-deals.ts` at 811 lines. The two source files above 1,000 lines are generated declarations and were already above the threshold at HEAD. `tests/tools/cart.test.ts` is 1,159 lines, also unchanged by the current work. There is no new 1,000-line crossing to block on.

> The findings and line references below describe the pre-fix snapshot. Implementation and verification results are recorded in the remediation section at the end.

**1. [P1] The cart state machine has no authoritative success outcome.**

Evidence: [cart-action.ts:40](../views/app/cart-action.ts), [tool-calls.ts:137](../views/app/tool-calls.ts), [cart.ts:302](../src/tools/cart.ts).

`addListToCart` returns `Promise<void>` and treats absence of `isError` as success. The controller consequently transitions to `added` for every fulfilled call. However, the server deliberately returns a non-error result with zero added items and `actionDetail: "No Kroger items to add"` when a list has no cartable products. For example, a list can change after its UI was rendered and before the shopper clicks Add. The controller then reports success and disables the saved-list action even though nothing was added.

Confirmed with an isolated test using the server's actual `appResult` shape: a zero-item result produces `status: "added"`. This is a contract gap retained by the recent state refactor, not evidence that the state-controller approach itself is wrong.

Remedy: define a cart tool result with explicit outcomes such as `added`, `already_added`, and `needs_match`, plus the existing error/recovery outcomes. Return it consistently from inline, list, and deduplicated paths. Decode it in the tool boundary and let the UI transition from that outcome. Do not infer the outcome from prose or merely from a fulfilled promise. Add cases for zero cartable items, partial adds, already-added results, and malformed success responses.

**2. [P1] Pantry expiry rendering can crash on a normal data update.**

Evidence: [pantry.tsx:60](../views/app/views/pantry.tsx).

`ExpiryBadge` calls one `useMemo`, returns early when expiry is absent, and calls two more hooks only when expiry is present. Updating the same keyed pantry item from no expiry to a future expiry changes the hook count. The production app has no local error boundary around that badge.

Confirmed in a browser against the existing `PantryView`: the update throws “Rendered more hooks than during the previous render.” The reproduction used a far-future date so the item stayed in the same list group and retained its identity.

Remedy: remove the unnecessary memoization from these small calculations. Then centralize expiry classification in one pure function consumed by pantry grouping, badges, shopping-profile output, and meal-planning context. Those places currently recalculate related date rules; the profile even labels expired items as “expiring soon,” while meal planning separates them. Test absence-to-date, date-to-absence, invalid dates, and the existing expiry thresholds.

Resolution (2026-09-18): `classifyExpiry` now owns the shared day calculation and explicit `none`, `invalid`, `expired`, `today`, `soon`, and `ok` states. Pantry grouping, expiry badges, the compact formatter, shopping-profile output, and meal-planning context consume it. The badge and row no longer memoize small conditional calculations, so a keyed item can safely change between missing and present expiry data. Pure classification tests cover missing, invalid, expired, today, one-to-three-day, boundary, and later dates; profile output now labels expired items explicitly.

**3. [P2] Cart deduplication still has two authorities.**

Evidence: [cart.ts:249](../src/tools/cart.ts), [cart-operations.ts:19](../src/cart-operations.ts), [user-storage.ts:249](../src/utils/user-storage.ts).

The Durable Object journal is documented as authoritative, but the list handler reads the legacy KV receipt first and can return without consulting the journal or reading the current list. A corrupt legacy receipt fails the request even if a valid journal entry exists. An existing receipt also bypasses the journal's changed-item fingerprint check. When the seven-day KV receipt expires, the same list instead goes through the journal path, potentially producing a different result and a different response shape. New successful operations continue writing both representations.

This does not justify deleting legacy receipts outright: they protect pre-journal writes from duplication. It does justify removing migration policy from the tool handler.

Remedy: put legacy receipt reconciliation behind the cart-operation service, with an explicit safe migration policy for pre-journal records. Have one domain operation own completion, conflict detection, and the result returned to all callers. Preserve protection for old cart writes. Keep the assistant mirror explicitly best-effort and separate from mutation authority. Test legacy-only receipts, corrupt receipts with known journal state, edited lists, and receipt expiry.

**4. [P2] Weekly deals lack a fully validated domain boundary, and presentation interprets warning prose.**

Evidence: [weekly-deals.ts:50](../src/tools/weekly-deals.ts), [weekly-deals.ts:446](../src/tools/weekly-deals.ts), [qfc-weekly-deals.ts:158](../src/services/qfc-weekly-deals.ts).

The cache schema validates three deal fields, allows other fields through, and then casts the result to the complete `QfcDealsApiResponse`. Fields such as price, dates, circular metadata, and degradation metadata are not established by that parser. The network helper similarly accepts a generic `T` and returns `parsed as T`. The newly strict app-view parser sits downstream, so it can reject data that the cache layer already certified as valid.

Confirmed with an isolated test: a deal with `price: { malformed: true }` is accepted by `parseCacheEntry` as normalized deal data. Separately, UI warning handling branches on `startsWith("KV cache read failed")` and exact text matches. Changing diagnostic wording therefore changes presentation behavior.

Remedy: define the normalized deal/result schema in the service layer, infer its type, and use it for both live-source normalization and cache reads. Represent warning reasons as codes with structured details, formatting them only for the intended audience. Separate source adapters, cache/fallback policy, and MCP presentation; `item-flags` and meal planning should depend on the deal service rather than importing cache internals from a tool registrar. Preserve print-offer conditions and existing stale-fallback behavior during this change.

**5. [P2] The shopping-store contract preserves obsolete ownership and erases read invariants.**

Historical evidence: [shopping-list.ts](../src/tools/shopping-list.ts), the removed `gateway-storage.ts` adapter, and [user-storage.ts](../src/utils/user-storage.ts). This finding predates the Worker-owned D1 migration.

Every list create generates a requested ID and passes it through the storage interface; the only production implementation ignores it because the gateway owns identity. Tests still implement the caller-owned-ID model. The same `ShoppingListItem` type describes both drafts and persisted records, making `id` and `checked` optional even though the gateway requires and provides those facts on reads. Tool responses compensate with `itemId=unknown` fallbacks.

The adapter also converts gateway quantity strings with `Number.parseFloat(value) || 1`. This silently turns nonnumeric data or zero into one and accepts numeric prefixes. The numeric domain type hides that interpretation from later cart code.

Remedy: use `create({ name, items }) -> ShoppingList`, with no discarded ID hint. Separate draft items from stored items with required durable identity. Move these domain types out of cart-only KV persistence. Make quantity conversion explicit: either validate the numeric shopping quantity or preserve free-form quantities as a distinct representation that cannot be added to a cart until resolved. Align test stores with gateway ownership.

**6. [P2] Product compatibility rules are scattered and already disagree.**

Evidence: [shopping-list.ts:101](../src/tools/shopping-list.ts), [orders.ts:79](../src/tools/orders.ts), [cart.ts:290](../src/tools/cart.ts), [resources.ts:148](../src/tools/resources.ts).

Inputs, storage, formatting, resource completion, and views each interpret the relationship between universal `product`, serialized `productRef`, and deprecated `upc`. The cart correctly treats an explicit non-Kroger reference as authoritative and ignores a leftover UPC. Product-resource completion instead falls back to `item.upc` whenever the provider is not Kroger. Thus the same gateway record can be rejected as non-Kroger by the cart but advertised as a Kroger product by completion.

Remedy: normalize legacy UPCs into a canonical product reference when data enters the domain, with one policy for conflicting fields. Preserve deprecated wire fields at compatibility adapters only. Shared consumers should operate on the canonical reference; only the Kroger adapter should turn a Kroger reference into a cart UPC. Add a conflict fixture containing an explicit non-Kroger reference and a legacy UPC, and verify consistent behavior across consumers.

**7. [P2] The new shopping outcome model starts too late to remove upstream ambiguity.**

Evidence: [kroger-search.ts:15](../src/services/catalog/kroger-search.ts), [shopping-outcomes.ts:23](../src/services/shopping-outcomes.ts), [shop.ts:212](../src/tools/shop.ts).

Both search contracts still combine `failed: boolean`, an optional error, products, and sometimes a redundant count. The new classifier consequently accepts contradictory states and fabricates an error when a failed search has none. Actual search producers already know whether each term succeeded or failed; information is lost in the declared type and reconstructed later. `shop_for_items` then recombines request, search result, and selection using parallel array indexes.

The recent extraction makes the handler easier to read, but leaves an avoidable layer of interpretation. This is a missed simplification in the refactor rather than a demonstrated production failure.

Remedy: make the per-term search result a union at its producer: successful candidates or a required error, carrying the request identity. Derive counts at presentation. Keep search failure out of selection, and combine selection with its request explicitly. The shopping summary should aggregate valid outcomes rather than repair impossible combinations. Preserve the distinction between successful empty searches and failed searches, and keep current partial-result behavior.

Resolution (2026-09-18): Kroger and provider-agnostic search results now use explicit success/failure unions with a required error on failures and a caller-owned request ID on every result. Internal result counts are derived from successful product arrays at the presentation boundary. `shop_for_items` passes only successful searches to selection and joins searches, selections, and requests by ID; successful empty searches remain distinct from failures, and partial failures still produce usable matched items with warnings. Producer, selector, outcome, formatter, and tool tests cover these cases.

**8. [P2] Handler tests bypass the input contract and encourage production fallbacks.**

Evidence: [v2-tool-handler.ts:52](../tests/v2-tool-handler.ts), [tool-test-harness.ts:200](../tests/tools/tool-test-harness.ts), [shopping-list.ts:118](../src/tools/shopping-list.ts).

The shared handler wrapper forwards `Record<string, unknown>` directly to callbacks and validates only their output. It does not apply each registered input schema. Consequently defaults, coercions, transformations, and refinements differ from the production MCP path. Production code explicitly defaults quantity again “rather than relying on parsing having run.” Numerous tests capture registration independently, so the same contract mismatch is repeated.

The real MCP evals and protocol tests are valuable and do exercise an actual boundary; this finding does not claim the entire suite bypasses validation.

Remedy: make the normal test tool caller invoke the real registered MCP server, or parse with the exact registered schema before calling its callback. Give deliberately raw-handler tests a separately named entry point. Fix fixtures that depended on skipped defaults rather than retaining redundant production branches for them. This should precede broad type simplification so tests protect the intended runtime contract.

**Validation and limits**

- Two temporary characterization tests passed in the isolated Vitest 4.1.11 copy, confirming findings 1 and 4. Their passing means they reproduced the undesirable current behavior; they are not regression fixes.
- A temporary browser harness confirmed finding 2 using the existing pantry component. No production component was edited for the reproduction.
- The current working tree's `pnpm test` failed before running tests: Vitest 5.0.1 was outside the Cloudflare runner's declared `^4.1.0` peer range, and the run reported 50 worker errors. This audit therefore does not claim a passing current-dependency suite. Dependency changes remain assigned to the other task.
- The prior full isolated run passed 797 tests with three skipped. It predates these temporary audit reproductions and is not a new full-suite run for this review.
- No live Kroger writes, deployments, dependency edits, or production-code changes were made for this audit.

**Recommended implementation order**

1. Repair test-boundary fidelity and add regressions for the two confirmed UI defects.
2. Establish explicit cart tool outcomes and fix expiry rendering.
3. Normalize stored domain records, product references, and per-term search outcomes at their boundaries.
4. Reconcile cart receipts behind one operation service without discarding legacy duplicate protection.
5. Give weekly deals one validated model and separate source, cache, and presentation responsibilities.

Keep the direct guards for invalid inputs, disconnection, and real business alternatives. The goal is to eliminate repeated decisions and impossible states, not to minimize the number of `if` tokens.

## Remediation

The fixes use three Luna subagents with maximum reasoning effort, followed by integration review and validation.

| Finding                     | Change                                                                                                                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Cart success            | Cart responses carry an explicit `added`, `already_added`, or `needs_match` outcome. The client decodes the result before updating its state; ambiguous responses require checking the cart. |
| 2 — Expiry rendering        | A pure expiry classifier replaces conditional hooks and supplies the shared rules for the pantry, shopping profile, and meal-planning context.                                               |
| 3 — Cart authority          | The journal claims each operation before reconciling legacy receipts. Existing journal state wins; legacy-only receipts retain duplicate protection.                                         |
| 4 — Weekly-deals boundary   | Shared schemas validate consumed source fields and normalized live/cache data. Warning codes replace prose matching. Cache and fallback policy lives in the service layer.                   |
| 5 — Shopping-store contract | The gateway owns list IDs. Draft and stored items have separate types; stored records require IDs and checked state. Invalid numeric quantity strings fail validation.                       |
| 6 — Product identity        | Boundary adapters normalize saved Kroger references into UPCs. The domain and views use UPCs only; foreign references never fall back to a conflicting Kroger UPC.                           |
| 7 — Search outcomes         | Search producers return success/failure unions with request identity. Selection receives successful searches and results are joined by request identity.                                     |
| 8 — Test contract           | The normal test caller applies the exact registered schema, including defaults, coercions, transforms, and refinements. Raw callback tests use an explicit separate helper.                  |

Dependency manifests remain assigned to the separate dependency task. Integration tests use the isolated Vitest 4.1.11 environment because the separate dependency task's local Vitest 5.0.1 manifest is outside the Cloudflare runner's declared compatibility range.

### Final verification

All eight findings above have been addressed in the working tree.

- Full isolated Cloudflare/Vitest 4.1.11 suite: **834 passed, 3 skipped** across 54 test files (53 passed, one skipped).
- `pnpm build`: passed, including standard lint, type-aware lint, production view bundling, and source/view TypeScript checks.
- `pnpm fmt:check` and `git diff --check`: passed.
- Browser regression using the real pantry component: the same item transitioned from absent expiry to a future date, back to absent expiry, and then to an invalid date without losing the view or logging an error.
- Cart regressions cover zero cartable items, already-added outcomes, partial adds, malformed fulfilled responses, blocked retries after ambiguous responses, and journal/legacy reconciliation.
- No handwritten production file crossed 1,000 lines as a result of these fixes.

The test result applies to the isolated compatible dependency environment, not the separate dependency task's local Vitest 5 manifest. No dependency files were edited by this remediation. No live cart mutations or deployments were performed.

### PR integration verification

The PR branch was integrated with main at `368ed13` (the shared UI variants and shadcn lint rules). All three overlapping component conflicts preserve the new design-system variants and the outcome/expiry behavior from this review.

A fresh checkout installed the committed dependencies with `pnpm install --frozen-lockfile`. On that checkout, `pnpm test` passed **834 tests with 3 skipped**, and `pnpm build`, `pnpm fmt:check`, and `git diff --check` passed. The PR does not change `package.json` or `pnpm-lock.yaml`; it retains main's Vitest 4.1.11 dependency range. This validates the PR's own dependency set independently of the concurrent dependency updates described above.

### Kroger-only simplification

The server now supports Kroger/QFC directly. Product search uses one `storeId` and
returns UPCs; the provider registry, capabilities, per-provider search orchestration,
and provider-aware UI controls have been removed. The raw Kroger search service keeps
request identity and explicit failure outcomes. Existing `kroger:<UPC>` tool inputs
and gateway/app product references remain accepted only at compatibility boundaries.
Named items without a Kroger UPC remain readable but need matching before a cart add.

The gateway contract is shared with another service, so its existing product-reference
wire format is preserved by the gateway adapter. That format no longer determines the
internal model or requires a multi-provider tool surface.

Final Kroger-only validation on the PR checkout: **837 passed, 3 skipped** across
54 test files. `pnpm build` (lint, type-aware lint, production views, and both
TypeScript projects), `pnpm fmt:check`, and `git diff --check` passed. The
simplification removes 434 net lines from production source and views while
preserving the earlier audit fixes. Dependency manifests remain unchanged.

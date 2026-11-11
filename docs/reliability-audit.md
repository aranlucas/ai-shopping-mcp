# Correctness and reliability audit — 2026-11-06

Baseline: remote default `62539df` (merged untangle pass). Clean isolated worktree. Tests/builds run only in CI; local lint/static inspection are allowed.

## Inventory and trust boundaries

- `server.ts`, `services/better-auth.ts`: HTTPS issuer/JWKS/resource configuration, bearer JWT verification (issuer/audience/type/algorithms/scope), host/origin checks, token broker RPC. `composition.ts` creates request-local clients and issuer/subject-scoped stores. No credentials persisted here.
- `tools/`: store/product search → saved lists → cart add; pantry/equipment/profile; completed order records; weekly deals; saved meal-plan review/preparation. Zod validates tool inputs. MCP resources/prompts and `app-results.ts` are public contracts.
- `utils/d1-*-storage.ts`, schema/migrations: shopper-owned rows, atomic pantry additions, optimistic versioned list/plan edits, transactional plan-to-list preparation. KV holds optional shared catalog/deal caches.
- `cart-operations.ts`: Durable Object claims before upstream mutation; completed operations deduplicate, ambiguous responses remain pending; definitive rejections release claims. The same per-user object stores the assistant's add history (atomic append, newest 100 within seven days) and saved cart ID. Add history is explicitly best effort and not a live cart.
- Kroger clients: typed openapi-fetch, per-request auth/cancellation/deadline, one retry for transient GET responses only. External API fixtures must replace production in ordinary tests.
- Embedded views: MCP tool results → validated discriminated payload → React actions. Product/list/cart actions, list editing, meal review and error recovery. Preview supplies controlled fixtures, not production authentication.
- CI currently generates bindings, lints/formats, typechecks, builds views and runs Worker/Node Vitest suites. Existing protocol, tenant isolation, optimistic concurrency, cart ambiguity, meal-plan and cache tests are retained.

## Confirmed findings (recorded before implementation)

1. **High confidence, medium impact: pantry consumption loses decrements.** `src/tools/inventory.ts:consumePantryItems` reads once, computes absolute quantities independently, and writes in parallel. Starting at 12, removal entries Eggs=2 and eggs=3 leave 9 or 10 instead of 7. Separate concurrent requests also overwrite one another or concurrent additions. Expected: every consumption applies once against current persisted quantity, deleting exhausted rows. Fix: D1 arithmetic in a single ordered batch including exhausted-row cleanup/readback. Regressions cover duplicate casing, concurrent requests, exhaustion, and another shopper.
2. **High confidence, medium impact: duplicate exact list names select an arbitrary list.** `src/tools/shopping-list.ts:get_shopping_list` disambiguates partial matches only. Creating two lists named Dinner then requesting Dinner opens the first even though names are not unique. Expected: return both IDs for selection; explicit listId still selects precisely. Regressions exercise duplicate exact names and unique exact-over-partial preference.

3. **High confidence, medium impact: fractional saved packages reach Kroger.** Independent review traced saved-list quantity=1.5 (permitted by the public list API) into cart PUT, whereas checked-in `kroger/cart.json` requires integer quantities. Preserve fractional lists, reject noninteger cart packages before claiming/sending with an actionable error.
4. **High confidence, medium impact: concurrent view edits can display an incomplete saved list.** Request initiation order (`latestEdit`) does not imply commit order. Prevent overlapping edits in the view; backend concurrency remains supported.

## Rejected hypotheses / limits

- Cart retries are not blindly repeated: the durable journal blocks pending/ambiguous writes and fingerprints changed input. Confirmed-success product reset intentionally creates a new list; existing tests protect that behavior. No change justified.
- Shared catalog cache does not include cart/identity clients; shopper persistence predicates include userId. No demonstrated cross-shopper leak found.
- Meal preparation uses version/status conditions inside D1 batch and returns the existing list on retry; no second-list race established.
- Multi-step list editing explicitly reports earlier committed edits on failure; atomic whole-tool edits are not an established requirement.
- Independent review confirmed the concurrent view-edit concern; a narrow single-flight guard addresses it.
- No claim of production OAuth/Kroger end-to-end coverage: credentials/services are outside controlled CI. Existing authenticated protocol fixtures validate these boundaries.

## Requested e2e framework

Verified npm `e2e@0.23.0` is tester-army/e2e (published Node requirement ^22.22.3 or >=24.8.0). Read published bundled skill/setup/writing references and current quickstart, CI, GitHub Actions docs. Use `@e2e-dev/web` with pinned published version and no model/credentials. Existing preview renders production view components against a fixture MCP client: journeys can verify editable lists, cart error recovery and success, but do not prove backend persistence or real checkout. Worker/Vitest protocol and D1 regressions remain the backend authority. No unrelated UI or paid provider is added.

## Validation and review

Independent same-provider review challenged the findings and implementation in successive static rounds. It confirmed pantry arithmetic, cart validation, and list disambiguation, and requested stale list-response invalidation and baseline evidence for every fix; both are implemented. No further concrete worthwhile findings remained at final static review.

No local tests or builds executed. Dependencies installed with `--ignore-scripts`; only Worker type generation (required by lint) and static lint/formatting run locally. CI runs existing suites, builds views and Worker, and new deterministic view journeys. Separate baseline checks restore the original handlers/view and require assertion failures for duplicate pantry removal, ambiguous names, fractional cart quantities, and overlapping view edits. Logs plus e2e reports/traces are uploaded. CI evidence/merge outcome pending.

Dependencies `e2e@0.23.0` and `@e2e-dev/web@0.15.5` were selected because they are the requested upstream runner and compatible published browser engine, pinned in the lockfile; no agent model is configured. Existing drizzle-orm implements transactional consumption; no custom SQL client or helper script was added.

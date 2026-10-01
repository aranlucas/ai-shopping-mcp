# Improvements backlog

Open findings for the Worker (`src/`), the MCP App views (`views/`), tests, CI/CD,
config, and docs. First audited September 2026; re-checked against the code after
the tool consolidation (18 → 13 tools) and the agent eval landed. Fixed items
have been removed.

| Check                               | Result                                                           |
| ----------------------------------- | ---------------------------------------------------------------- |
| `pnpm lint` (standard + type-aware) | clean                                                            |
| `pnpm fmt:check`                    | clean                                                            |
| `pnpm typecheck`                    | clean                                                            |
| `pnpm coverage`                     | 829 passed; 94.1% statements, 83.2% branches                     |
| `pnpm audit --prod`                 | 28 advisories (11 high, 13 moderate, 4 low), all transitive      |
| `pnpm eval:agent` (4 free models)   | 57/60 tasks on 18 tools; 13-tool rerun in progress (see PR #140) |

Severity: **High** means fix soon, **Medium** means schedule it, **Low** is hygiene.

---

## Summary

The codebase is in good shape: explicit dependency injection, typed errors
(`neverthrow` plus `AppError`), idempotent journaled cart writes, a hardened
OAuth flow, D1 queries scoped by `user_id`, high test coverage, and now an agent
eval that drives the real MCP server. The main gaps:

1. **No per-user rate limiting or input caps.** One user can use up the whole
   app's Kroger API quota and AI Gateway budget, or write unbounded rows.
2. **Concurrent pantry writes can lose updates** (E1). Hosts run parallel tool
   calls concurrently, so this is reachable today.
3. **Storage grows forever**, and users cannot delete their data.
4. **The token-refresh code is the least-tested security path** (`server.ts`
   is at 78% coverage).
5. **The agent eval is too easy to separate capable models** and its graders and
   fixtures produce false signals (T6–T9).

---

## 1. Security

### High

**S1. No rate limiting on any MCP tool.** Every authenticated request fans out to
the Kroger API: `search_products` makes up to 10 text searches plus one detail
call per UPC term (uncapped by design, five in flight at a time), and weekly
deals makes several. `shop_for_items` also makes a paid Jev/OpenRouter call
through AI Gateway (`src/services/product-selector.ts`). Kroger's quotas apply to
the whole application, so one looping client can take product search offline for
everyone. Dynamic client registration (`/register`) is open, as MCP expects, so
the natural throttle key is the shopper ID.
_Fix:_ add a [Workers Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
keyed by `userId` in `buildServer` (or `mcpApiHandler`), with a tighter bucket
for `shop_for_items` and for UPC-heavy `search_products` calls. Return an
`API_ERROR` with status 429 so `errorRecovery` maps it to `retry_later`.

**S2. Unbounded array inputs.** These have `.min(1)` but no `.max()`:
`create_shopping_list.items` and `update_shopping_list.add` / `.change` /
`.remove` (`src/tools/shopping-list.ts`), `record_order.items`
(`src/tools/orders.ts`), and `update_inventory.pantry.add` / `.remove` and
`.equipment.add` / `.remove` (`src/tools/inventory.ts`). A list stores its items
as one JSON blob that every edit rewrites, so a huge list approaches D1's 2 MB
row limit and slows every later edit; large inventory arrays can exceed D1's
per-batch limits. `listId` / `itemId` strings have no length cap.
_Fix:_ cap arrays (for example 100 items per call, 500 per list, 100 order lines).
`search_products` UPC terms are intentionally uncapped; S1 is their guard.

### Medium

**S3. The Kroger client secret is copied into every OAuth grant.** `/callback`
stores `krogerClientId` and `krogerClientSecret` in grant props
(`src/kroger-handler.ts:331`), and the refresh callback reads them back
(`src/server.ts:87`). The props are encrypted, but every grant carries the app
secret, and rotating it breaks refresh for existing users.
_Fix:_ read `env.KROGER_CLIENT_ID` / `SECRET` in `tokenExchangeCallback` by
constructing the `OAuthProvider` inside `fetch` so the callback closes over
`env`. Fall back to the grant fields only for grants issued before the change.

**S4. The Kroger refresh can race.** Kroger refresh tokens are single-use. Two
concurrent `refresh_token` grants can both pass `isKrogerTokenExpiring`
(`src/server.ts:110`) and both call Kroger; the second gets `invalid_grant` and
the user is told to reconnect.
_Fix:_ serialize refresh per grant (a short lock in the per-user
`CartOperations` DO or a small `TokenRefresh` DO), with a concurrency test.

**S5. `regenerate-worker-types` runs dependency code with a write token.** It uses
`pull_request_target` with `contents: write`, checks out the Dependabot branch,
and runs that branch's `wrangler`. A compromised release could push to any
Dependabot branch.
_Fix:_ generate in a read-only `pull_request` job, upload the file as an
artifact, and commit it from a `workflow_run` job that runs no dependency code,
or drop the workflow since CI regenerates types before typechecking.

**S6. Transitive advisories grew from 9 to 28.** `pnpm audit --prod` reports
`fast-uri`, `js-yaml`, `smol-toml`, `undici`, and `brace-expansion` (high), plus
`qs`, `ip-address` (moderate) and `@ai-sdk/provider-utils` (low), mostly via
`agents` and `shadcn`. `shadcn` is only needed at build time for
`shadcn/tailwind.css`, so move it to `devDependencies`, add `pnpm.overrides` for
patched versions, and gate CI on `pnpm audit --prod --audit-level=high` (A3).

**S7. Internal details reach tool output.** `formatAppError` appends
`JSON.stringify(error.detail)` (`src/errors.ts:186`); `safeStorage` /
`fromApiResponse` embed raw exception text (D1 SQL errors, upstream bodies); and
weekly-deals warnings forward fetch errors verbatim (eval transcripts show
"Unexpected external fetch…" reaching the model).
_Fix:_ log details server-side and give the model the message plus `recovery`.

### Low

- **S8.** `/callback` does not guard the token `fetch` or `tokenResponse.json()`
  (`src/kroger-handler.ts:252`); an HTML 5xx or timeout becomes an unhandled 500.
- **S9.** The grant scope is the client-requested `oauthReqInfo.scope`
  (`src/kroger-handler.ts:322`), not what Kroger granted.
- **S10.** The approved-clients cookie grows without a limit
  (`src/workers-oauth-utils.ts`). Past ~20 approvals it exceeds 4 KB and browsers
  drop it. Keep the N most recent.
- **S11.** The approval form's `state` is unsigned base64 JSON. Not exploitable
  today, but an HMAC with `COOKIE_ENCRYPTION_KEY` is cheap defense in depth.
- **S12.** `src/services/qfc-weekly-deals.ts` calls `*.przone.net` with a scraped
  public key and a spoofed `User-Agent`. Document it and feature-flag it.
- **S13.** `.claude/settings.json` pre-approves `Bash(curl:*)` for agents. Scope it
  to specific hosts or remove it.

---

## 2. Tool surface and agent behavior

Found while building and running the agent eval. See
`docs/tool-surface-review.md` for the per-tool review behind the consolidation.

- **E1. Pantry quantity updates can lose writes (Medium).** "Used 6 eggs" reads
  the pantry, subtracts in JavaScript (`consumePantryItems`,
  `src/tools/inventory.ts`), and writes an absolute quantity
  (`updateQuantity`, `src/utils/d1-shopping-storage.ts:249`). Two concurrent
  calls, from parallel tool calls or quick taps on the app's **Use one** button,
  both read 12 and both write 11. Shopping lists don't have this problem: they
  use a version check with retries (`mutateList`).
  _Fix:_ decrement in SQL (`quantity = quantity - ?`) and delete rows at or below
  zero in the same `db.batch`, with a concurrency test.
- **E2. The cart can't be read back reliably.** `view_cart` needs a Kroger cart id
  that no tool returns, so it falls back to the assistant mirror, and
  `add_shopping_list_to_cart` returns no prices or total. Two eval models
  flagged this in TOOL FEEDBACK. Return line prices and an estimated total from
  the add, and show the same in the mirror.
- **E3. Product facts are text-only.** UPC lookups now return allergens, claims,
  ingredients, nutrition, and ratings to the model, but `ProductData`
  (`src/app-results.ts`) has no fields for them, so the product detail view
  can't show them. Add optional fields and render them in the view.
- **E4. Scanned barcodes miss.** Kroger ids are 13 digits without the barcode
  check digit. A 12-digit UPC-A from a scanner is padded with its check digit
  still on. Accept barcodes explicitly (validate the check digit and drop it),
  or document that only copied `upc=` values work.
- **E5. "Expires today" fires a day early.** `classifyExpiry` floors
  milliseconds into days, so an item expiring in 23 hours reads as "today".
  Compare calendar dates in the user's timezone instead.
- **E6. `record_order` miscounts for the reader.** `totalItems` sums quantities,
  so a two-line order of 2 milk + 1 eggs reads "3 items"; one model reported it
  as wrong. Say "3 units across 2 items".
- **E7. Try namespaced tool names.** Generic names (`search_products`,
  `view_cart`) can collide with other commerce servers in the same host. Measure
  a `kroger_` prefix with the agent eval before adopting it.

---

## 3. Scalability and data lifecycle

- **D1. Cart-journal entries never expire.** `CartOperations`
  (`src/cart-operations.ts`) keeps every completed operation, and inline adds
  without an `operationId` create a new key each call. Add a DO alarm that
  deletes `completed` entries older than ~30 days and keeps `pending` ones.
- **D2. D1 has no retention policy.** Orders, lists, and pantry rows are kept
  forever; the nightly cron only purges OAuth KV. Add a retention sweep to
  `scheduled` (for example lists untouched for 180 days).
- **D3. Users cannot delete their data.** Nothing erases a user's lists, orders,
  DO journal, and `user:{id}:*` KV keys. Add a delete-my-data path; this service
  stores purchase history.
- **D4. Cart idempotency is scoped per OAuth client.** The journal key includes
  `clientId` (`src/composition.ts`), so the same list added from desktop and
  mobile is added twice. Key list operations by user if that isn't intended.
- **D5. Kroger API quota** is the practical ceiling on users. See S1.

---

## 4. Accessibility (MCP App views)

- **A11Y3.** The approval page's Cancel links to `/`, which has no route. Redirect
  to the client's `redirect_uri` with `error=access_denied`, or render a
  "cancelled" page.
- **A11Y4.** No automated a11y checks. Run `vitest-axe` or Playwright with
  `@axe-core/playwright` against `views/preview.html` in each theme.

---

## 5. Architecture and maintainability

- **M1. Cart adds require a store they don't use.** `add_shopping_list_to_cart`
  resolves a location (`safeResolveLocationId` in `src/tools/cart.ts`), but the
  Kroger cart API takes none; the store only feeds the success message. A user
  with no preferred store gets an error for an add that would have worked. Make
  resolution best-effort, or drop `storeId`.
- **M2. `record_order` is not idempotent.** Ids are `ORD-${Date.now()}-${random}`,
  so a retry records a duplicate. Accept an optional client `orderId`, as the cart
  does with `operationId`.
- **M3. Version drift.** `SERVER_INFO.version` is `1.1.0`; `package.json` is
  `1.0.0`. Use one source.
- **M4. Stale generated types pass silently.** CI regenerates
  `worker-configuration.d.ts` before typechecking; fail instead when the
  committed copy differs (`git diff --exit-code` after `cf-typegen`).
- **M5. Leftover config.** `.oxlintrc.tailwind.json` allowlists class names from
  another project (`oral-boards-shell`, `cn-input-otp`, `toaster`).
- **M6. `compatibility_date` is `2025-03-10`.** Update it deliberately, together
  with the copy hard-coded in `vitest.config.ts`.

---

## 6. Testing and evals

- **T1. `src/server.ts` is at 78% line coverage.** The uncovered lines are the
  `tokenExchangeCallback` branches (429 and 503 mapping, missing-rotation
  `invalid_grant`, not-yet-expiring). Test the callback directly with a stubbed
  `fetch`, plus the concurrent-refresh case from S4.
- **T2. Low branch coverage** in `tools/shop.ts` (60%) and
  `weekly-deals/format.ts` (56%).
- **T3. No component tests for the React views.** Add React Testing Library plus
  axe tests for the stateful views (shopping list, product search, pantry).
- **T4. No migration-drift check.** Run `drizzle-kit generate` in CI and fail on a
  diff, so a `src/db/schema.ts` edit without a migration can't merge.
- **T5. Schedule the paid and free live evals.** Run the agent eval weekly from
  the `Agent Eval` workflow (it runs on demand and on PRs today) to catch model
  and API drift; the Jev selector evals could share a budget-capped job.
- **T6. The agent eval barely separates capable models.** The baseline was 57/60,
  with three models near-perfect. Add harder tasks: substitutions under a budget,
  allergen and dietary questions (now answerable from UPC lookups), multi-store
  price comparison, and recovery after a `MUTATION_OUTCOME_UNKNOWN`. Run each task
  three times and report pass^3, since free models vary between runs.
- **T7. Answer graders are brittle.** `missing-item` failed a correct answer
  ("No such product exists at Kroger — I searched and got zero results") because
  its regex wanted specific wording. Use a
  cheap LLM judge (`FactualityJudge` in vitest-evals) for answer text, and keep
  regexes for end state.
- **T8. Fixtures mislead models.** Unknown search terms synthesize a generic
  product (models then "substitute" it), fixture stores list only Monday and
  Tuesday hours, and the weekly-deals circular endpoints aren't mocked, so every
  deals call carries a fetch-failure warning. Make unknown terms return nothing,
  give stores full hours, and mock the circular endpoints.
- **T9. Schema rejections are invisible in eval metrics.** The AI SDK rejects
  invalid tool input before `execute`, and vitest-evals records those calls as
  `pending`, so `toolErrors` stays 0. Qwen's 16 rejected `search_stores` calls in
  one run reported zero errors. Count `pending` calls as rejections in
  `TaskChecksJudge` metadata and the summary.

---

## 7. Automation and CI/CD

- **A3.** Add `pnpm audit --prod --audit-level=high` (or `osv-scanner`) to CI, and
  enable CodeQL and secret scanning if they are not already on.
- **A4. No deploy pipeline.** Deploys and `db:migrate:remote` are manual. A
  `deploy.yml` on `main` (migrate, then deploy, behind an environment approval)
  plus a staging environment would stop code from running against an unmigrated
  schema.
- **A5. Node version is not enforced everywhere.** `.cursor/environment.json`
  installs "24" while `.node-version` and `engines` require 24.18.1, and nothing
  sets `engine-strict` locally. Minor.
- **A6.** CI installs dependencies separately in each job. A shared composite
  setup action would reduce duplication.

---

## 8. Observability

- **O1. Sentry only sees uncaught exceptions,** but nearly every failure becomes an
  MCP `isError` result. Report `INVALID_RESPONSE`, `MUTATION_OUTCOME_UNKNOWN`,
  and unexpected `STORAGE_ERROR`s with `Sentry.captureException`, tagged by tool,
  without user data.
- **O2. Logs are unstructured strings.** Emit JSON (`{ tool, code, userHash,
durationMs }`) so Workers Logs can be queried; hash the shopper id.
- **O3. No metrics for Kroger quota use or AI Gateway cost.** Analytics Engine
  counters per tool would support S1 and D5.

---

## 9. Documentation

- **Doc2.** No `SECURITY.md` for vulnerability reports, and no privacy or
  data-retention statement, though the service stores purchase history.
- **Doc3.** An architecture diagram (OAuth → OAuthProvider → MCP handler →
  D1/KV/DO/Kroger/AI Gateway) would help new contributors more than more prose.

---

## Suggested order of work

1. E1 pantry race, S1 rate limiting, and S2 input caps: small, independent, and
   they remove the largest correctness and abuse risks.
2. T1 refresh-callback tests, then S3 (secret from env) and S4 (serialize refresh).
3. Eval quality: T9, T7, T8, then T6, so tool changes are measured against
   signal rather than noise.
4. T4 migration-drift check, A3 audit in CI, S6 overrides.
5. D1–D3 retention, a DO alarm, and a delete-my-data path.
6. E2 cart readback and E3 product facts in the view.
7. A4 deploy pipeline with staging, then O1–O3 observability.

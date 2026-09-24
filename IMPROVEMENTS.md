# Codebase audit — September 2026

Scope: the Worker (`src/`), the MCP App views (`views/`), tests, CI/CD, config, and docs,
as of `b11bf22`. I read the code and ran every repository check:

| Check                               | Result                                                   |
| ----------------------------------- | -------------------------------------------------------- |
| `pnpm lint` (standard + type-aware) | clean                                                    |
| `pnpm fmt:check`                    | clean                                                    |
| `pnpm typecheck`                    | clean                                                    |
| `pnpm coverage`                     | 817 passed / 3 skipped; 93.4% statements, 82.4% branches |
| `pnpm audit --prod`                 | 9 advisories (6 high, 2 moderate, 1 low), all transitive |
| `wrangler deploy --dry-run`         | 4.36 MiB upload / 830 KiB gzip (now 1.95 MiB / 392 KiB)  |
| `vite build` (views)                | 635 kB single-file HTML / 179 kB gzip                    |

Severity: **High** means fix soon, **Medium** means schedule it, **Low** is hygiene.
Items marked ✅ are fixed in the same PR as this report.

---

## Summary

The codebase is in good shape. Dependency injection is explicit, errors are typed
(`neverthrow` plus `AppError`), cart writes are idempotent and journaled in a
Durable Object, the OAuth flow has CSRF, PKCE, signed cookies, and approvals
bound to the redirect URI, D1 queries always filter by `user_id`, and test
coverage is high. The main gaps:

1. **No per-user rate limiting or input caps.** One user can use up the
   whole app's shared Kroger API quota and AI Gateway budget, or write
   unbounded rows into D1 and the Durable Object.
2. **Storage grows forever.** Cart-operation journal entries, order history, and
   shopping lists are never pruned, and users have no way to delete their data.
3. **Automation gaps.**
   CI has no migration-drift check or dependency audit, and there is no deploy
   pipeline.
4. **The token-refresh code is the least-tested security path** (`server.ts`
   is at 77% coverage).

---

## 1. Security

### High

**S1. No rate limiting on any MCP tool.** Every authenticated request fans out to
the Kroger API (`search_products` makes up to 10 calls, and weekly deals makes several),
and `shop_for_items` makes a paid Jev/OpenRouter call through AI Gateway on every
invocation (`src/services/product-selector.ts`). Kroger's public API quotas apply
to the whole application, so one abusive or looping client can take product
search offline for all users and run up AI spend. Dynamic client registration
(`/register`) is open, which is expected for MCP, so the only natural throttle
key is the shopper ID.
_Fix:_ add a [Workers Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
keyed by `userId` in `buildServer` (or in `mcpApiHandler`), with a tighter bucket
for `shop_for_items`. Return a normal `API_ERROR` with status 429 so
`errorRecovery` maps it to `retry_later`.

**S2. Unbounded array inputs.** These schemas have `.min(1)` but no `.max()`:
`create_shopping_list.items` / `add_shopping_list_items.items`
(`src/tools/shopping-list.ts:58,65`), `record_order.items`
(`src/tools/orders.ts:22`), and `add_to_inventory.items` /
`remove_from_inventory.items` (`src/tools/inventory.ts:51,65`). The consequences:

- ✅ Pantry and equipment writes issued one D1 statement per item in a loop,
  which was not atomic. They now run as one `db.batch` (see P3). A very large
  array can still exceed D1's per-batch limits, so the cap is still needed.
- A list stores its items as one JSON blob, and each edit rewrites the whole blob,
  so a huge list approaches D1's 2 MB row limit and makes every later edit slow.
- `listId`/`itemId` strings have no length cap.

_Fix:_ cap arrays (for example 100 list items per call, 500 per list, 100 order
lines, 100 inventory items).

### Medium

**S3. The Kroger client secret is copied into every OAuth grant.** `/callback`
stores `krogerClientId` and `krogerClientSecret` in grant props
(`src/kroger-handler.ts:331`), and the refresh callback reads them back instead of
reading `env`. The props are encrypted, but this puts the app secret into every
grant record. Rotating the secret also breaks refresh for every existing user,
because old grants keep the old value.
_Fix:_ read `env.KROGER_CLIENT_ID`/`SECRET` in `tokenExchangeCallback`. The
callback does not receive `env` (v0.10.3), so construct the `OAuthProvider` inside
`fetch` and let the callback close over `env`. Keep reading the grant fields only
as a fallback for grants issued before the change.

**S4. The Kroger refresh can race.** Kroger refresh tokens are single-use. Two
concurrent `refresh_token` grants for the same grant can both pass
`isKrogerTokenExpiring` (`src/server.ts:108`) and both call Kroger. The second
gets `invalid_grant`, which the callback turns into "Reconnect the MCP server".
_Fix:_ serialize the refresh per grant, for example with a short-lived lock
in the existing per-user `CartOperations` DO or in a small `TokenRefresh` DO. Add
a test for the concurrent case.

**S5. The `regenerate-worker-types` workflow runs dependency code with a write token.**
It uses `pull_request_target` with `contents: write`, checks out the Dependabot
branch, and runs `pnpm run cf-typegen`, which executes the _updated_ `wrangler`
from that branch. `--ignore-scripts` blocks install hooks but not the
binary itself. A compromised `wrangler` release could push to any Dependabot
branch. The actor guard limits exposure, but this is still a supply-chain path.
_Fix:_ run typegen in a `pull_request` job with read-only permissions, upload
the generated file as an artifact, and commit it from a separate
`workflow_run` job that runs no dependency code. Alternatively, drop the
workflow, since CI already regenerates types before typechecking.

**S6. Transitive advisories.** `pnpm audit --prod` reports `fast-uri` (4 high, SSRF
and host confusion), `smol-toml` (high, DoS), `js-yaml` (high), `qs` (2 moderate),
and `@ai-sdk/provider-utils` (low). They come from `agents` and `shadcn`.
`shadcn` is only needed at build time for `shadcn/tailwind.css`, so it should
be a `devDependency`. Add `pnpm.overrides` for the patched versions and add
`pnpm audit --prod --audit-level=high` to CI (see A3).

**S7. Internal details reach tool output.** `formatAppError` appends
`JSON.stringify(error.detail)` (`src/errors.ts:186`), and `safeStorage`/`fromApiResponse`
embed raw exception messages such as D1 SQL errors and upstream bodies in the text
the model sees. This is low-risk, but it discloses internals and wastes tokens.
_Fix:_ log the detail server-side and give the model the message plus
`recovery` only.

### Low

- **S8.** `/callback` does not guard `tokenResponse.json()` or the token `fetch`
  (`src/kroger-handler.ts:252`). An HTML 5xx or a timeout from Kroger becomes an
  unhandled 500 instead of a readable error.
- **S9.** The grant scope is the client-requested `oauthReqInfo.scope`
  (`src/kroger-handler.ts:322`), not the scopes Kroger actually granted or an
  intersection with `scopesSupported`.
- **S10.** The approved-clients cookie grows without a limit
  (`src/workers-oauth-utils.ts:660`). After about 20 approvals it exceeds the 4 KB
  cookie limit and browsers drop it silently. Cap it to the N most recent approvals.
- **S11.** The approval form's `state` is unsigned base64 JSON. `completeAuthorization`
  re-validates the redirect URI and PKCE, so it cannot be exploited today, but
  signing it (HMAC with `COOKIE_ENCRYPTION_KEY`) would be cheap defense in depth.
- **S12.** `src/services/qfc-weekly-deals.ts` calls a third-party host
  (`*.przone.net`) with a scraped "public" API key and a spoofed
  `User-Agent: Mozilla/5.0`. That is a terms-of-service and fragility risk. Document it,
  and feature-flag it so it can be switched off without a deploy.
- **S13.** `.claude/settings.json` pre-approves `Bash(curl:*)` for agents. That
  is a broad exfiltration primitive; scope it to specific hosts or remove it.
- ✅ **S14.** `ci.yml` had no `permissions:` block, so it inherited the repository's
  default token scope. It now declares `contents: read`.

---

## 2. Performance

- ✅ **P1. The Worker bundle was 4.36 MiB (830 KiB gzip); it is now 1.95 MiB
  (392 KiB gzip).** Almost all of the excess came from one import:
  `src/utils/result.ts` took `getMcpAuthContext` from `agents/mcp`, the package
  index, which also bundles the MCP client, the v1 SDK (`@modelcontextprotocol/sdk@1.30`),
  and `capnweb`. `composition.ts` already used `agents/mcp/server`. The import now
  uses that entry point, and an `eslint/no-restricted-imports` rule in
  `.oxlintrc.json` blocks `agents` and `agents/mcp` so this cannot come back. What
  remains is the MCP server SDK (~400 KB), `@sentry/core`, `zod`, `drizzle-orm`, and
  the OAuth provider.
- ✅ **P2. The KV cache awaited its write on every miss** (`createKrogerCacheMiddleware`).
  The write now runs through `ctx.waitUntil`, so a cache miss no longer adds a KV
  `put` to the tool call's latency. Cache keys sort their query parameters, so the
  same search with parameters in another order shares an entry. Cache hits never
  wrote to KV; openapi-fetch skips `onResponse` when `onRequest` returns a
  response. The Cache API is not an option: it does nothing on `*.workers.dev`,
  where production runs.
- ✅ **P3. Sequential D1 writes.** Pantry and equipment add/remove now send every
  write and the read-back in one `db.batch`. That is one round trip, and it is
  atomic: a failing statement leaves nothing written (tested).
- ✅ **P4. `shoppingList.list()` loaded every list's `items_json`** to count
  items. It now selects `json_array_length(items_json)`.
- **P5. Every request builds a new server.** I looked into this and made no change. Registration
  stores Zod schemas and closures; JSON Schema conversion happens only for
  `tools/list`, and the stateless handler runs one method per request. Hoisting
  definitions would need a module-level server and would give up the
  per-request dependency injection. That trade isn't worth it without a
  measured CPU cost, which `workerd` can't measure in tests because timers are frozen.
- **P6. The view bundle is 647 kB (182 kB gzip).** I looked into this and made no change. The largest parts are
  `react-dom` and the MCP protocol runtime that `@modelcontextprotocol/ext-apps`
  imports from `@modelcontextprotocol/client`. Its unused transports and OAuth
  code are already tree-shaken. There is no cheap win left short of replacing
  React (for example with `preact/compat`), which isn't worth the compatibility risk
  for a single iframe document.

---

## 3. Scalability and data lifecycle

- **D1. Cart-journal entries never expire.** `CartOperations`
  (`src/cart-operations.ts`) keeps every completed operation forever, and inline
  adds without an `operationId` create a new random key on every call
  (`src/tools/cart.ts:144`). Per-user DO storage grows without a limit. Add a
  DO alarm that deletes `completed` entries older than about 30 days, keeping
  `pending` ones as the design requires.
- **D2. D1 has no retention policy.** Order history, shopping lists, and pantry
  rows are kept indefinitely. The nightly cron only purges OAuth KV. Add a retention
  sweep to `scheduled`, for example lists untouched for 180 days.
- **D3. Users cannot delete their data.** Pantry and equipment have `clear()`,
  but lists and orders do not, and no tool or endpoint erases everything a
  user has stored. That matters for privacy expectations (and CCPA-style requests),
  since this service stores purchase history. Add a `delete_my_data` path
  that covers D1, the DO journal, and the `user:{id}:*` KV keys.
- **D4. Cart idempotency is scoped per OAuth client.** Lists belong to the user
  in D1, but the journal key includes `clientId` (`src/composition.ts`). Adding the
  same list from two clients, such as desktop and mobile, will add it twice.
  If that is not intentional, key list operations by user only.
- **D5. Kroger API quota.** See S1. This is the practical ceiling on user count.
  Cache hit rates and per-user limits determine how far it scales.

---

## 4. Accessibility (MCP App views)

The views are generally well done: live regions on action buttons, `role="alert"`
for errors, labeled `<select>`, `aria-hidden` on decorative icons, and host
theming through `light-dark()` tokens with dark-mode palette remaps.

- ✅ **A11Y1. The icon-only Remove buttons in Pantry and Kitchen Equipment had
  no accessible name while busy and a generic name when idle.** Their labels were
  `""`. The only name came from `aria-label="Remove"` on the SVG, and that SVG is not
  rendered in the loading, done, or error states. Screen-reader users heard an
  unlabeled button, or "Remove" repeated for every row. They now use
  `labelContext` ("Remove: Eggs") with a new `iconOnly` option on `ActionButton`
  that keeps the state text available to screen readers only.
- ✅ **A11Y2. The OAuth approval page had a mismatched heading** (`<h2>…</h1>`),
  which produces a broken document outline. Fixed.
- **A11Y3.** The approval page's Cancel button links to `/`, which has no route
  and returns an error page. Link to the client's `redirect_uri` with
  `error=access_denied` (the OAuth-correct cancel), or render a plain
  "cancelled" page.
- **A11Y4.** There are no automated a11y checks. Add `vitest-axe` or
  Playwright + `@axe-core/playwright` against `views/preview.html` in each theme,
  since the preview harness already renders every state.

---

## 5. Architecture and maintainability

**Strengths:** explicit DI in `composition.ts`, per-module dependency types,
repository interfaces (`shopping-store.ts`) with one D1 implementation,
`neverthrow` throughout, and a small typed error union with recovery hints.

- **M1. Cart tools require a store they do not use.** `add_shopping_list_to_cart`
  accepts `storeId` and calls `safeResolveLocationId`
  (`src/tools/cart.ts:262,386`), but the Kroger cart API does not take a
  location. The store only feeds the success message, yet a user with no
  preferred store gets a hard error for a cart add that would have
  worked. Make location resolution best-effort, or remove `storeId`.
- **M2. `record_order` is not idempotent.** IDs are `ORD-${Date.now()}-${random}`
  (`src/tools/orders.ts:58`), so a retry records a duplicate order. Accept an
  optional client-supplied `orderId`, as the cart path does with `operationId`.
- **M3. Version drift.** `SERVER_INFO.version` is `1.1.0` and `package.json` is `1.0.0`.
  Use one source.
- **M4. `worker-configuration.d.ts` (600 KB) is committed and regenerated in CI.**
  That is fine, but make sure CI fails if the committed copy is stale
  (`git diff --exit-code` after `cf-typegen`) instead of overwriting it silently.
- **M5. Leftover config.** `.oxlintrc.tailwind.json` allowlists class names from
  another project (`oral-boards-shell`, `cn-input-otp`, `toaster`, and others).
- **M6. `compatibility_date` is `2025-03-10`, about 18 months old.** Update it
  deliberately to pick up runtime fixes, and keep `vitest.config.ts` in sync,
  because it hard-codes the same date.

---

## 6. Testing

**Strengths:** 817 tests on the real `workerd` pool, OAuth integration tests,
storage-backed tool tests against D1 and the DO, contract and token-budget evals, and
tests for cart state machines.

- **T1. `src/server.ts` is at 77.5% line coverage.** The uncovered lines are the
  `tokenExchangeCallback` branches: 429 mapping, 503 mapping, the
  missing-rotation `invalid_grant`, and the not-yet-expiring path. This is the
  most security-sensitive code in the repository. Add unit tests that call the callback
  directly with a stubbed `fetch`, plus the concurrent-refresh case from S4.
- **T2. Low branch coverage in `tools/shop.ts` (58.5%) and `tools/location.ts`
  (61.8%)**, and in `weekly-deals/format.ts` (55.6%).
- **T3. No component tests for the React views.** Only the pure modules
  (`cart-action`, `tool-calls`, routing) are tested. Add React Testing Library
  plus axe tests for the stateful views (shopping list, product search,
  pantry).
- **T4. No migration-drift test.** Nothing checks that `src/db/schema.ts` matches
  `migrations/`. `tests/d1-schema.ts` applies the migrations, but a schema edit
  without `db:generate` would pass CI and then fail in production. Run
  `drizzle-kit generate` in CI and fail on a diff.
- **T5.** The Jev live evals are manual only, which is reasonable because they cost
  money. Consider a weekly scheduled workflow with a budget cap to catch model
  drift.

---

## 7. Automation and CI/CD

- **A1. (Corrected.)** The first version of this report said the Tailwind lint
  never ran. That was wrong. `.oxlintrc.json` extends `.oxlintrc.tailwind.json`
  and sets `settings.tailwindcss.entryPoint`, so its rules run in `pnpm lint`. The
  error I saw came from running the extended file on its own.
- ✅ **A2. CI never built the views.** A broken Vite build could merge. The
  test job now runs `pnpm build:views`. `concurrency` also cancels superseded PR
  runs.
- **A3.** Add `pnpm audit --prod --audit-level=high` (or `osv-scanner`) to CI, and
  enable CodeQL / secret scanning if they are not already on.
- **A4. No deploy pipeline.** Deploys and `db:migrate:remote` are manual, and the
  README requires running migrations before deploying. A `deploy.yml` on `main`
  (migrate, then `wrangler deploy`, with an environment approval gate) would
  remove the risk of deploying code that runs against an unmigrated schema.
  A staging Worker environment in `wrangler.jsonc` would let migrations be tested first.
- **A5. The Node version does not match everywhere.** `.node-version` and `engines` require
  24.18.1, but `.cursor/environment.json` installs "24" and nothing enforces it
  locally (`engine-strict`). Minor.
- **A6.** CI installs dependencies three times (lint, typecheck, test). That is fine
  for parallelism. A shared setup composite action would reduce duplication.

---

## 8. Observability

- **O1. Sentry only captures uncaught exceptions,** but almost every failure is
  converted into an MCP `isError` result, so Sentry sees very little.
  Report `INVALID_RESPONSE`, `MUTATION_OUTCOME_UNKNOWN`, and unexpected
  `STORAGE_ERROR`s with `Sentry.captureException` (without user data), tagged
  with the tool name.
- **O2. Logs are unstructured strings.** Emit JSON objects (`{ tool, code, userHash,
durationMs }`) so Workers Logs / Logpush can be queried. Hash the shopper ID
  rather than logging it raw.
- **O3. No metrics for Kroger quota use or AI Gateway cost.** Workers Analytics
  Engine counters per tool would support S1 and D5.

---

## 9. Documentation

The README is detailed and accurate: 18 tools and 4 prompts, which I checked against the code.

- ✅ **Doc1.** `SENTRY_DSN` is an optional secret (`src/env.ts`) that the README
  did not list. It is now listed.
- **Doc2.** There is no `SECURITY.md` for vulnerability reporting, and no privacy or
  data-retention statement, even though the service stores purchase history and pantry data.
- **Doc3.** An architecture diagram (OAuth → OAuthProvider → MCP handler →
  D1/KV/DO/Kroger/AI Gateway) would help new contributors more than more prose.

---

## Suggested order of work

1. S1 rate limiting and S2 input caps. These are small, independent changes
   that remove the largest abuse risks.
2. T1 refresh-callback tests, then S3 (secret from env) and S4 (serialize refresh).
3. T4 migration-drift check, A3 audit in CI, S6 overrides.
4. D1–D3 retention, a DO alarm, and a delete-my-data path.
5. A4 deploy pipeline with a staging environment.
6. O1–O3 observability.

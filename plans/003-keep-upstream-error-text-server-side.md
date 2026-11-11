# Plan 003: Upstream error bodies and URLs stay server-side in weekly-deal warnings

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fae55db..HEAD -- src/services/qfc-weekly-deals.ts src/services/weekly-deals/ src/tools/meal-planning-deals.ts test/services/qfc-weekly-deals.test.ts test/tools/weekly-deals.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (warning wording only; eval snapshots may need updating)
- **Depends on**: none (pairs well with 002)
- **Category**: security
- **Planned at**: commit `fae55db`, 2026-11-11

## Why this matters

`src/errors.ts` states the policy that an `AppError` message is model-facing and
raw upstream payloads stay server-side (`cause`/`detail`). The weekly-deals path
breaks it. `fetchJson` in `qfc-weekly-deals.ts` builds errors containing the
request URL, up to 200 characters of a non-JSON body, up to 400 characters of an
error body, or the full zod error. `safeErrorMessage(error)` copies those into
warning `details.error`. The formatter then shows them to the model and the app,
and because warnings are part of the cached data, they are written to shared KV
and shown to every shopper at that location. Third-party body text in the model's
context is also an untrusted-text path.

## Current state

- `src/services/qfc-weekly-deals.ts` `fetchJson` (~lines 172–214): messages
  `Invalid JSON from ${url} … ${text.slice(0, 200)}`,
  `HTTP ${status} for ${url}: ${errorText}`, `Invalid response from ${url}: ${zod message}`.
- Same file: `weeklyDealWarning("circular_fetch_failed" | "print_ad_failed" |
  "search_augmentation_failed" | "search_failed", { error: safeErrorMessage(error) })`
  and `meta.failureMessages`.
- `src/services/weekly-deals/format.ts` puts `details.error` into text and the app payload.
- `src/services/weekly-deals/service.ts` (~line 105) wraps the raw message in `networkError(...)`.

## Steps

1. Keep `fetchJson`'s detailed message as the thrown error's `cause` and log it
   (`console.error`), but put only a fixed, code-specific phrase plus the HTTP
   status (if any) into warning `details.error` and `meta.failureMessages`.
2. In `service.ts`, use a fixed `networkError("Weekly deals are unavailable right now. Try again shortly.", error)`
   message and keep the raw error as `cause`.
3. Tests: an upstream 500 whose body contains a sentinel string → the tool text,
   the app payload and the cached KV value do not contain the sentinel or the
   upstream URL; the warning code is still present.

**Verify**: `pnpm typecheck && pnpm exec vitest run --maxWorkers=1 test/services/qfc-weekly-deals.test.ts test/tools/weekly-deals.test.ts` → all pass.

## Done criteria

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm fmt:check` exit 0; full `vitest --maxWorkers=1` passes
- [ ] `grep -n "text.slice(0, 200)" src/services/qfc-weekly-deals.ts` only appears in a logged/cause path

## STOP conditions

- A deterministic eval (`test/evals/`) depends on raw error text; report which one.

## Maintenance notes

- Related, deferred: frame deal and catalog text as untrusted data in
  `get_weekly_deals`, `get_shopping_profile` and `search_products`, as
  `shop_for_items` already does (`src/tools/shop.ts:188`).

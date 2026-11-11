# Plan 002: A temporary print-ad failure is never cached as fresh weekly deals

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fae55db..HEAD -- src/services/qfc-weekly-deals.ts src/services/weekly-deals/service.ts test/services/qfc-weekly-deals.test.ts test/tools/weekly-deals.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (more live refetches while the print-ad source is failing)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `fae55db`, 2026-11-11

## Why this matters

Weekly deals are cached in shared KV per location. The service skips the
cache write only when `meta.degraded === true`. When the primary print-ad
(DACS) path throws, `fetchQfcWeeklyDeals` falls back to the Kroger search API
and returns a result that is **not** marked degraded unless search terms also
failed. That weaker fallback is then cached as fresh until the circular's
`eventEndDate`, which can be up to about seven days. So one DACS timeout pins
worse deals, plus a `print_ad_failed` warning, for every shopper at that store
for the rest of the ad week. A failed search augmentation on the print path
has the same problem.

## Current state

- `src/services/qfc-weekly-deals.ts` (`fetchQfcWeeklyDeals`, ~lines 720–860):
  - print path: `meta.degraded = true` only when `failedPageCount > 0`;
    a caught augmentation failure pushes `search_augmentation_failed` but does not set degraded.
  - `catch` around the print path pushes `print_ad_failed`, then the search
    fallback sets `meta.degraded = true` only when `failedTermCount > 0`.
- `src/services/weekly-deals/service.ts` (~lines 125–150): `degraded && staleEntry` →
  serve stale; `degraded` → add `live_refresh_partial`/`not_cached`; otherwise
  `weeklyDealsCache.write(cacheKey, liveData)`.
- `src/services/weekly-deals/cache.ts` (`writeWeeklyDealsCache`): `freshUntil`
  is the latest circular end time, else a fallback TTL.

## Commands you will need

| Purpose   | Command                                                                                                      | Expected |
| --------- | ------------------------------------------------------------------------------------------------------------ | -------- |
| Typecheck | `pnpm typecheck`                                                                                             | exit 0   |
| Tests     | `pnpm exec vitest run --maxWorkers=1 test/services/qfc-weekly-deals.test.ts test/tools/weekly-deals.test.ts` | all pass |
| Lint      | `pnpm lint && pnpm fmt:check`                                                                                | exit 0   |

## Scope

**In scope**: `src/services/qfc-weekly-deals.ts`, and tests in
`test/services/qfc-weekly-deals.test.ts` / `test/tools/weekly-deals.test.ts`.

**Out of scope**: cache TTL constants, the cache entry format/version, warning
wording (plan 003), and the stale-serving policy in `service.ts`.

## Steps

### Step 1: Mark fallback and partial print results degraded

In `fetchQfcWeeklyDeals`, set `meta.degraded = true` when the print path's
augmentation failed, and on the search fallback whenever a `print_ad_failed`
warning was recorded earlier in the same call. Track this with a local
boolean (`printFailed`), not by scanning warning strings.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Tests

Model after the existing print/search fallback tests in
`test/services/qfc-weekly-deals.test.ts`:

- print ad throws, search succeeds with no failed terms → `meta.degraded === true`.
- print ad succeeds, augmentation throws → `meta.degraded === true`.
- print ad succeeds fully → `meta.degraded` is not true (regression guard).
  In `test/tools/weekly-deals.test.ts`: with a print failure and a working
  search, no KV cache write happens and a later call retries live.

**Verify**: the test command above → all pass, including the new tests.

## Done criteria

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm fmt:check` exit 0
- [ ] New tests pass; `pnpm exec vitest run --maxWorkers=1` passes

## STOP conditions

- Existing tests assert that a print-failure fallback result is cached; that is a
  product decision, so report it instead of changing the tests.
- The fix appears to need a cache format/version change.

## Maintenance notes

- During a long DACS outage, every request without a stale entry hits live
  sources. If that becomes costly, add a short "degraded TTL" cache tier
  instead of reintroducing fresh caching.

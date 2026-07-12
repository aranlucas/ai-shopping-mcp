# Investigation: reviving the `shoppable-weekly-deals` API

**Date:** 2026-07-12
**Status:** Research note, not a design doc — no code changes implied yet.

## Why

While widening `deal-category.ts`'s keyword classifier (see
`docs/superpowers/specs/2026-07-12-weekly-deals-category-ordering-design.md`),
the obvious question came up: the classifier only exists because neither
current deal source (DACS print-ad scrape, Product Search fallback) carries
real category data. An earlier version of this codebase
(`f41be82`, "fix: replace LAF-based shoppable deals with Kroger Product
Search API") _did_ call a richer endpoint —
`/atlas/v1/shoppable-weekly-deals/deals` — but ripped it out, citing "brittle
QFC modality LAF object bootstrapping that was failing with anti-bot
protections." This note re-investigates that endpoint to find out exactly
what broke and whether it's worth reviving.

## What was tried, in order

1. **Official Kroger OAuth API.** Got a real `client_credentials` token
   (`product.compact` scope) from `https://api.kroger.com/v1/connect/oauth2/token`
   using this app's own registered credentials, then called
   `https://api.kroger.com/atlas/v1/shoppable-weekly-deals/deals`. **404** —
   this path never existed on the official developer API. It only ever lived
   on the retail _website's_ backend (`www.kroger.com` / `www.qfc.com`), not
   `api.kroger.com`.

2. **Direct `curl` to the website backend.**
   `https://www.qfc.com/atlas/v1/shoppable-weekly-deals/deals?filter.circularId=...`
   — TLS handshake succeeds, but the HTTP/2 stream resets with
   `INTERNAL_ERROR` before any response (same result over HTTP/1.1: the
   connection just dies, status `000`). This is edge/WAF-level bot
   protection (Akamai, based on the `/akam/13/...` sensor script and
   `/ffckacm5sm48e/...` obfuscated beacon endpoints observed later) rejecting
   the client itself — independent of headers or auth.

3. **Live browser network capture** (`claude-in-chrome`, navigating to
   `kroger.com/weeklyad?circularId=...`). Contrary to my initial assumption,
   **the page itself never calls `shoppable-weekly-deals` in normal
   operation** — its "This Week's Best Deals" grid is populated by
   `/atlas/v1/savings-coupons/v1/coupons` instead (the same endpoint this
   repo's git history shows being adopted once, in commit `37c1327`).
   Calling `shoppable-weekly-deals` manually from the page's own JS context
   (`fetch(..., { credentials: 'include' })`, so real session cookies were
   attached) still failed: `400 { "reason": "Channel Missing" }`. So the
   block isn't cookie/session-based — it's a missing application-level
   header the site's own fetch wrapper injects that plain `fetch()` doesn't.

4. **User-supplied HAR capture** (`www.kroger.com.har`, a real browser
   session that successfully loaded the same `circularId`). This is what
   cracked it. The HAR's request to `shoppable-weekly-deals/deals` returned
   **200**, with these headers beyond the ordinary browser set:

   | Header             | Example value                                                                                                  | Purpose                                                                               |
   | ------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
   | `x-kroger-channel` | `WEB`                                                                                                          | The missing piece step 3 hit — not literally named `channel`.                         |
   | `x-facility-id`    | `02100953`                                                                                                     | `{division}{store}` concatenated, matches the URL's `filter.store`/`filter.division`. |
   | `x-modality-type`  | `PICKUP`                                                                                                       | Fulfillment mode.                                                                     |
   | `x-modality`       | `{"type":"PICKUP","locationId":"02100953"}`                                                                    | Structured modality echo.                                                             |
   | `x-call-origin`    | `{"component":"weekly ad","page":"weekly ad"}`                                                                 | Just telemetry/attribution, not gating.                                               |
   | `x-laf-object`     | `[{"modality":{...},"sources":[{"storeId":...,"facilityId":...}],"assortmentKeys":[...],"listingKeys":[...]}]` | The actual "LAF object" the old code tried to bootstrap.                              |

   Replaying the exact call from the live browser tab (`javascript_tool`,
   same origin, same session cookies via `credentials: 'include'`) with
   these headers reconstructed from the HAR — **succeeded, 200, full 210KB
   response.**

## Correcting the "anti-bot" diagnosis

The old commit's framing — "brittle LAF object bootstrapping... failing with
anti-bot protections" — conflates two _separate_ problems, now that both are
visible:

- **The header/LAF-object contract itself is not a secret or a bot check.**
  It's a normal application parameter describing what store/modality/assortment
  you're asking for (`x-laf-object`'s `assortmentKeys`/`listingKeys`/`sources`
  fields are just structured store identifiers, derivable from a store lookup
  — nothing here requires solving a challenge or holding a bot-manager
  token). The old code likely broke because it tried to _derive_ this object
  dynamically from another endpoint that itself started failing, not because
  Kroger added a check on the object's contents.
- **The edge-level block from step 2 is a real, separate wall.** A bare
  `curl`/Workers `fetch()` with no browser TLS fingerprint, no prior page
  load, and no Akamai bot-manager cookies (`_abck`, `bm_sz`, etc. — set via
  the `/akam/13/...` sensor script during normal browsing) gets reset before
  the request even reaches the application layer that would check
  `x-kroger-channel`/`x-laf-object`. That's what actually killed step 2, and
  it's unrelated to whether you send the right headers.

## What this means for this repo

- **Not worth pursuing as a production data source.** Reproducing this from
  the Cloudflare Worker this MCP server runs in would mean either (a)
  driving a real headless browser to acquire Akamai bot-manager session
  cookies before every call, or (b) reverse-engineering and replaying
  whatever token/fingerprint scheme backs those cookies. Both are
  anti-bot-evasion engineering — fragile, likely to break again exactly like
  it did before, and not something to build into a shipped server.
- **The response shape confirms the existing hand-typed
  `weekly-deals.d.ts` `WeeklyDeal`/`WeeklyDealsResponse` types are accurate**
  (validated against a real 162-ad, 14-`adGroup` response) — that typing can
  stay as documentation of a data shape we know is real but unreachable, or
  be deleted if it's considered dead weight; it isn't imported anywhere
  today (`grep` confirms only `weekly-deals.d.ts` itself references it).
- **Even if it were reachable, `departments` is coarser than what
  `deal-category.ts` needs.** Across the 162 real ads: 68 (42%) carry
  _multiple_ department tags, and dairy/frozen/bakery/snacks all collapse
  into generic `GROCERY`/`DRUG/GM` buckets (Kroger has no separate
  DAIRY/FROZEN/BAKERY department in this data) — meaning even with the real
  field, a keyword layer would still be needed to split those buckets into
  the meal-planning categories this feature wants. It cleanly separates
  `MEAT`/`PKG MEAT`/`SEAFOOD`, `PRODUCE`, `LIQUOR`, `DELI/BAKE`, `GM`
  (household), `FLORAL`, `NATURAL FOODS` — and even that has occasional
  mistagging (one ad, "Boneless Pork Tenderloin", is tagged `SEAFOOD`).

  Department distribution across the sampled circular (162 ads):

  ```
  GROCERY:        81
  DRUG/GM:        67
  MEAT:           22
  PRODUCE:        19
  DELI/BAKE:      12
  GM:             11
  LIQUOR:         10
  NATURAL FOODS:   5
  SEAFOOD:         2
  PKG MEAT:        2
  FLORAL:          1
  ```

## Bottom line

The keyword classifier shipped in `deal-category.ts` remains the right call:
the richer data source exists, is real, and was successfully reached once —
but only from inside a fully-authenticated real browser session, and even
then wouldn't fully replace keyword matching. Reviving it isn't a quick
follow-up; it's a separate, higher-risk research project this note
deliberately stops short of.

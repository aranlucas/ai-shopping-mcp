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

5. **Isolating whether cookies/session actually mattered.** Repeated the
   same in-browser call with `credentials: 'omit'` (zero cookies sent,
   including no Akamai bot-manager cookies) — **still 200.** Then repeated
   it a third time as a completely bare `curl` from this machine — no
   browser, no TLS fingerprint matching Chrome, no prior page load, no
   cookies at all, just the headers from step 4 copied verbatim — **also
   200, full 162-ad response.**

## Correcting the "anti-bot" diagnosis

Step 5 overturns the original diagnosis, not just refines it. This is **not**
an anti-bot/WAF wall at all:

- **The header/LAF-object contract is just an ordinary application
  parameter**, not a bot check or a security token. `x-laf-object`'s
  `assortmentKeys`/`listingKeys`/`sources` fields are structured store
  identifiers; sending them via bare `curl` with no session, no cookies, and
  no browser fingerprint of any kind was sufficient. There is no bot-manager
  gate on this endpoint to defeat.
- **Step 2's failure (`curl` → HTTP/2 `INTERNAL_ERROR` reset) was caused by
  the missing headers themselves**, not edge/WAF fingerprinting as
  originally assumed. Once `x-kroger-channel`, `x-facility-id`, `x-modality`,
  `x-modality-type`, and `x-laf-object` are all present, a plain `curl`
  request completes normally over HTTP/2 with no special handling.
- The old codebase's framing ("failing with anti-bot protections") was
  likely a misdiagnosis at the time — probably because whatever it used to
  _derive_ the `x-laf-object` value broke, and the resulting malformed/empty
  header produced a connection-level failure that looked like bot detection
  rather than a clean 4xx.

## What this means for this repo

- **The data source is genuinely reachable from a plain server-side HTTP
  client** — including, in principle, this repo's Cloudflare Worker
  (`fetch()` behaves like `curl` here; no browser automation needed).
- **The response shape matches the existing hand-typed `weekly-deals.d.ts`
  `WeeklyDeal`/`WeeklyDealsResponse` types** (validated against a real
  162-ad, 14-`adGroup` response) — so re-adopting this wouldn't require
  new type authoring, just wiring.
- **The one remaining unknown: where `assortmentKeys` comes from for an
  arbitrary store.** In the HAR, `assortmentKeys: ["01f68952-b130-4e7f-87b8-af822d3e53c9"]`
  is not returned by any API call — it's embedded directly in the
  server-rendered HTML of `kroger.com/weeklyad` itself (inside the page's
  SSR state, alongside `handoffLocation`/`sources`), computed server-side by
  Kroger for that specific store + modality combination. To build a fully
  store-agnostic integration, this value would need to be scraped out of
  that SSR HTML per store (a lightweight HTML fetch + JSON-in-script
  extraction, not a browser), or another endpoint that returns it would need
  to be found. This wasn't chased down further in this session.
- **`departments` is coarser than what `deal-category.ts` needs.** Across
  the 162 real ads: 68 (42%) carry _multiple_ department tags, and
  dairy/frozen/bakery/snacks all collapse into generic `GROCERY`/`DRUG/GM`
  buckets (Kroger has no separate DAIRY/FROZEN/BAKERY department in this
  data) — meaning even with the real field, a keyword layer would still be
  needed to split those buckets into the meal-planning categories this
  feature wants. It cleanly separates `MEAT`/`PKG MEAT`/`SEAFOOD`,
  `PRODUCE`, `LIQUOR`, `DELI/BAKE`, `GM` (household), `FLORAL`,
  `NATURAL FOODS` — and even that has occasional mistagging (one ad,
  "Boneless Pork Tenderloin", is tagged `SEAFOOD`).

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

Reachability is solved: the endpoint works from a bare server-side HTTP
client with the right headers, no browser or anti-bot workaround needed. The
only unresolved piece for a production integration is deriving
`assortmentKeys` for a store the server doesn't already have a live
browser-rendered page for. If that gets solved, this becomes a real
candidate to replace or sit alongside the keyword classifier — richer data,
real prices, real `departments` — though the department taxonomy alone still
wouldn't fully replace `deal-category.ts` for the meal-planning-category use
case (see the coarseness note above). This is a genuine "worth scoping as
its own feature" candidate now, not a dead end — brainstorm it separately if
picked up.

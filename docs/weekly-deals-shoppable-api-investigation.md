# Investigation: reviving the `shoppable-weekly-deals` API

**Date:** 2026-07-12
**Status:** Workaround found and implemented — keep the private retail endpoint
disabled; use the DACS offer API for structured promotion details.

**Last verified:** 2026-07-12. The historical HAR evidence below is from the
repository's deleted `www.qfc.com.har` capture (the parent of commit
`3b02350`, recorded 2026-01-02).

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
   `kroger.com/weeklyad?circularId=...`). The observed traffic varied by page
   state: an earlier capture populated the "This Week's Best Deals" grid from
   `/atlas/v1/savings-coupons/v1/coupons`, while a fresh 2026-07-12 session
   also requested `shoppable-weekly-deals` after loading the weekly-ad page.
   Calling the private endpoint without the site's application headers failed
   with `400 { "reason": "Channel Missing" }`; supplying the reconstructed
   headers worked only while the browser had valid Akamai state. This confirms
   both that the endpoint is real and that it is not a stable Worker dependency.

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

## Reconciling the "anti-bot" diagnosis

The historical capture proved that the application-level contract is ordinary
and that a correctly formed request could work without a browser session. It
did **not** prove that the retail edge would remain available to a Worker:

- **The LAF object is application data, not a secret.**
  `x-laf-object`'s `assortmentKeys`/`listingKeys`/`sources` fields identify a
  store, facility, and assortment. They can be obtained from
  `modality/preferences` and then supplied to the deals request.
- **The earlier bare-client success was real but time-bound.** With all of
  `x-kroger-channel`, `x-facility-id`, `x-modality`, `x-modality-type`, and
  `x-laf-object` present, the historical request completed normally. That
  explains why the old code's malformed/empty LAF request looked like a bot
  failure at the time.
- **The current edge behavior is a real operational blocker.** The fresh
  2026-07-12 plain-client request returned an Akamai challenge (`429`,
  `cpr_chlge=true`) or reset the HTTP/2 stream. A browser session that already
  had Kroger's bot-manager state could load the page and receive `200` from
  both `modality/preferences` and `shoppable-weekly-deals` (104 current ads),
  but repeating the same calls from that page with `credentials: "omit"`
  immediately returned the `429` challenge. A Worker cannot safely depend on
  a private endpoint whose availability changes this way, and this
  investigation does not justify adding bot-manager evasion.

## The `assortmentKeys` question is solved, but the bootstrap is not stable

The historical HAR in this repository supplies the missing detail. The page
made this request before the deal/coupon calls:

```text
POST https://www.qfc.com/atlas/v1/modality/preferences?filter.restrictLafToFc=false
```

With `x-kroger-channel: WEB` and
`x-call-origin: {"page":"all","component":"CSR"}` (the HAR contained no
request cookies), the response was `200` and included
`data.modalityPreferences.lafObject`. For store `70500847`, that object
contained `facilityId: "4468"`, `listingKeys: ["70500847"]`, and
`assortmentKeys: ["edec10f5-2d40-4941-a280-2a405a537dcb"]`. Therefore the
server does not need to scrape SSR HTML, guess UUIDs, or receive
`assortmentKeys` from the official `digitalads` circular endpoint. The old
`tryBootstrapLafObjectFromQfc` implementation was aimed at the right API; its
initial HTML fetch was not the only possible bootstrap path.

However, this does not make the integration production-ready. Fresh probes on
2026-07-12 produced the following results:

- `api.kroger.com/digitalads/v1/circulars` returned the current QFC shoppable
  circular (`id=35933009-164e-4e4f-a58f-576f9ca0ea20`, valid 2026-07-08 through
  2026-07-15).
- A plain HTTP/2 POST to the historical `modality/preferences` path, with the
  historical browser-shaped headers, returned `429` with
  `{"cpr_chlge":"true"}` and Akamai bot-manager cookies.
- A standalone browser navigation failed with `ERR_HTTP2_PROTOCOL_ERROR`, and
  a deal request carrying the historical LAF object from plain `curl` failed
  with an HTTP/2 `INTERNAL_ERROR` rather than a JSON response.
- An already-running Chrome session with valid Kroger/Akamai state did load
  the page. In that session, `modality/preferences` returned the current
  pickup LAF object and the deal request returned `200` with 104 ads; the same
  browser context using `credentials: "omit"` received the `429` challenge.

This reconciles the earlier notes: the endpoint was demonstrably callable from
a bare client during the earlier capture, but the retail edge now sometimes
challenges or resets the same class of request. The application-level header
contract is understood; reliable server-side transport is the unresolved
operational problem.

## Online search result

The public documentation search did not uncover a supported replacement or a
stable implementation of this private endpoint:

- Kroger's [official public API collection](https://www.postman.com/kroger/the-kroger-co-s-public-workspace/documentation/ki6utqb/kroger-public-apis)
  documents the public developer surface, including Products, Locations, and
  Cart APIs, but does not document weekly ads, digital ads, or
  `shoppable-weekly-deals`.
- Kroger's [official Weekly Ad FAQ](https://www.kroger.com/hc/help/faqs/ways-to-save/weekly-ads)
  describes the supported user flow as selecting a preferred store and viewing
  the Weekly Ad on Kroger.com; it does not expose a server API contract for
  third-party integrations.
- Targeted searches for the exact endpoint and its `x-laf-object` headers found
  no public documentation or independent implementation to use as a more
  stable source.

This is not proof that Kroger has no internal successor, but it means there is
no documented API path to substitute directly for the private retail-web
request.

## GitHub search and the real API workaround

GitHub did turn up useful independent implementations, but they split into two
categories:

- [`ahornerr/krogetter`](https://github.com/ahornerr/krogetter) uses a stealth
  browser only to warm Akamai, then reuses the cookies for plain HTTP product
  API calls. That is a browser relay, not a Cloudflare Worker-compatible fix
  for this endpoint.
- [`easement/kroger-shopping-skill`](https://github.com/easement/kroger-shopping-skill/blob/main/scripts/kroger_web_capture.py)
  uses Playwright for live capture and deliberately prefers the DACS print-ad
  API before falling back to the private shoppable endpoint. Its fixture
  refresh confirms the private response shape but does not make the endpoint
  public or stable.
- [`mohdtalal3/ads_scraper`](https://github.com/mohdtalal3/ads_scraper/blob/main/kroger_weeklyad.py)
  exposes the important server-side path: public Digital Ads circular
  metadata → DACS listing → DACS page → DACS offer details. It calls
  `/api/dacs/{eventId}/offers/{offerVersionProductGroupId}` with the existing
  DACS public API key and does not require LAF headers or the Akamai-protected
  retail host.

The last path is the workable compromise for this Worker. A live QFC probe on
2026-07-12 confirmed that a DACS page's `mapConfig` contains an
`offerVersionProductGroupId`. For example, the current print circular
`fef7e80e-9e93-4d5f-bba9-de88305029c5` produced offer `1238808`, and:

```text
GET https://oms-kroger-webapp-da-classic-api-prod.przone.net/api/dacs/
    fef7e80e-9e93-4d5f-bba9-de88305029c5/offers/1238808?location=70500847
```

returned structured data including:

```text
headline: Lipton Tea
pricingText: BUY 3 GET 3 Of Equal or Lesser Value FREE With Card
startDate: 2026-07-08
endDate: 2026-07-14
disclaimer: Select Varieties, Limit 12 Packages
isShoppable: true
```

The Worker now performs that offer-details lookup for the selected DACS page
offers. It uses `pricingText`, dates, disclaimers, and the offer image when
available, and keeps the page-level deal if an individual enrichment request
fails. This turns the existing print fallback into a structured real-API
source without reviving LAF bootstrapping or browser automation.

This is still not a cart-ready product feed: DACS's `upc` field is commonly a
montage/image identifier such as `M_530686`, not a retail UPC. The existing
authenticated Product API remains the correct follow-up for matching a deal
title to concrete products and adding those products to a list or cart.

## What KrogerKrazy is doing

The linked [KrogerKrazy weekly-ad page](https://www.krogerkrazy.com/kroger-weekly-ad/)
is a useful lead, but it is not an alternate Kroger data API. It is a
WordPress page that manually publishes an ad preview:

- The page is exposed through the site's public WordPress REST route,
  `/kk_api/wp/v2/pages?slug=kroger-weekly-ad`.
- The current response is page `id=275477`, titled
  `Kroger Weekly Ad Preview 7/15/26-7/21/26`, modified 2026-07-10.
- `content.rendered` contains the prose and five image blocks, with uploaded
  JPEGs identified by `data-id` values `506555` through `506559`.
- The media endpoint, for example
  [`/kk_api/wp/v2/media/506555`](https://www.krogerkrazy.com/kk_api/wp/v2/media/506555),
  returns image metadata and the original upload URL. It does not return
  products, UPCs, store IDs, promotion rules, or structured prices.

The page itself explicitly warns that the preview varies by region and that
the official Kroger site/app is needed for local pricing and availability.
That matches the implementation: this is a manually maintained, generic
image archive, not a scraper of the QFC/Kroger shoppable-deals endpoint.

The technically possible reuse path would be:

```text
WordPress page JSON → extract JPEG URLs → OCR/vision each ad page → normalize
deal text and prices → optionally match products through Kroger Product API
```

That could provide generic weekly-ad inspiration, but it would be lossy and
regionally inaccurate. It cannot replace the current QFC source for
store-specific, shoppable results without adding a separate OCR pipeline and
explicitly labeling the output as a non-local preview.

## What this means for this repo

- **The private retail data source was reachable from a plain server-side HTTP
  client during the historical capture**, but the current retail edge
  challenges or resets the same request. That distinction rules it out as a
  dependable dependency for this repo's Cloudflare Worker.
- **The DACS offer API is the concrete workaround.** It is already the source
  of the print-ad fallback, requires no OAuth or LAF object, and now supplies
  structured pricing text and promotion metadata through a bounded,
  best-effort enrichment pass in `src/services/qfc-weekly-deals.ts`.
- **The response shape matches the existing hand-typed `weekly-deals.d.ts`
  `WeeklyDeal`/`WeeklyDealsResponse` types** (validated against a real
  162-ad, 14-`adGroup` response) — so re-adopting this wouldn't require
  new type authoring, just wiring.
- **`assortmentKeys` derivation is known but no longer needed for the selected
  path.** It is still required by the private retail endpoint, which remains
  disabled. Do not scrape SSR HTML, hard-code the value, or add browser state
  to this Worker.
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

The investigation is complete and the workaround is implemented. The private
`shoppable-weekly-deals` endpoint and its LAF/Akamai dependency are understood
but remain unsuitable for this Worker. The supported-enough server-side path
is the public Digital Ads circular metadata plus DACS listing/page/offer APIs,
with authenticated Product API matching when concrete UPCs are needed.

Keep the DACS offer enrichment and Product Search fallback. Do not add LAF
bootstrap code, browser cookies, stealth tooling, or anti-bot workarounds to
the Worker. The `departments` field from the private response remains useful
research evidence, but it is not needed for the production path and its
taxonomy is too coarse to replace `deal-category.ts`.

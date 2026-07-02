# Feature Roadmap

Future features for the Kroger/QFC shopping MCP server, prioritized by value relative to effort. Each entry explains why it's worth building, how it fits the existing architecture, and what it depends on.

A guiding constraint for everything below: the Kroger public API only exposes products, locations, cart, and identity. Coupons, pickup time slots, order history, and nutrition data are **not** available, so every feature here is designed around what we can actually reach — the public API, the QFC weekly-ad scrape, and our own KV data.

---

## Tier 1 — High value, builds on what exists

### 1. Deal-aware meal planning

**What:** Feed the current week's QFC deals into `get_meal_planning_context` so the host model plans meals around what's on sale, and let shopping-list creation surface sale-priced swaps for list items.

**Why it's good:** This is the single thing a human actually does with a weekly ad — "what's cheap this week, and what can I cook with it?" We already have both halves (`get_weekly_deals`, `get_meal_planning_context`); they just don't talk to each other. It turns two standalone tools into the core workflow of the product.

**How:**

- `get_meal_planning_context` optionally calls the QFC deals fetcher (`src/services/qfc-weekly-deals.ts`) and includes a compact deals summary in its structured context output. No sampling — the host model does the planning, consistent with the existing design.
- Add an `onSale` annotation when shopping-list items match a current deal (reuse the case-insensitive matching conventions from `user-storage.ts`).

**Depends on:** Deals caching (Tier 3, #8) makes this fast, but it works without it.

### 2. Pantry-aware shopping lists

**What:** When building a shopping list from a recipe or meal plan, subtract what the pantry already has — "you have flour and eggs; only adding butter."

**Why it's good:** It makes the pantry feature pay for itself. Today the pantry is write-mostly: users maintain it but nothing meaningful reads it. This closes the loop and directly reduces wasted spend, which is the product's pitch.

**How:**

- A pantry reconciliation option for shopping-list creation: for each candidate item, check `PantryStorage` using the existing case-insensitive dedup matching, and return a split of "already have" vs "need to buy."
- Surface the split in the shopping-list view (`views/app/views/`) so the user can override ("actually I'm out of flour").

**Depends on:** Nothing. The matching machinery already exists in `src/utils/user-storage.ts`.

### 3. Replenishment suggestions from order history

**What:** A `suggest_restock` tool (or enrichment of the `shopping://user/order-history` resource) that infers purchase cadence — "you buy milk roughly every 10 days; last bought 12 days ago."

**Why it's good:** `OrderHistoryStorage` already keeps the last 50 orders and nothing reads them for insight. This is pure KV reads plus date math — no new Kroger API surface, no scraping — and it gives the assistant something proactive to say, which is what makes an MCP shopping assistant feel useful rather than transactional.

**How:**

- Compute per-item median interval between purchases across order history; flag items past their interval.
- Read-only tool (`readOnlyHint: true`, `openWorldHint: false`), output schema in `src/tools/output-schemas.ts`, optionally a small view.
- Items flagged for restock can flow into #2's pantry-aware list building.

**Depends on:** Enough order history accumulating via `record_order` to be useful; degrade gracefully (return "not enough history yet") below a threshold.

---

## Tier 2 — High value, new data surface

### 4. Price history and list cost estimation

**What:** Persist price snapshots from every product search, then (a) show an estimated total before `add_shopping_list_to_cart` sends items to the cart, and (b) flag when a price is unusually high or low.

**Why it's good:** Every `search_products` call already returns prices we throw away. Capturing them is nearly free and unlocks two features users consistently want: "how much will this cost?" before checkout, and "is this actually a good deal?" — which also makes the deal planning in #1 smarter (a "sale" price that matches the everyday price is not a deal).

**How:**

- New `PriceHistoryStorage` in `src/utils/user-storage.ts` keyed `price:{locationId}:{upc}`, storing `{price, promoPrice, date}` snapshots with a retention cap (mirror the order-history 50-entry pattern).
- Write snapshots opportunistically inside existing product-search and deals flows; never add extra API calls just to record prices.
- `add_shopping_list_to_cart` sums known prices and reports coverage honestly before cart handoff ("estimated $47.20, prices known for 9 of 12 items").

**Watch out for:** KV write volume — batch snapshots per search, and keep keys global (not per-user) since prices are per-store, not per-person.

### 5. Dietary preferences and household profile

**What:** A `PreferencesStorage` class (allergies, dislikes, dietary pattern, household size) with a `manage_preferences` tool and a `shopping://user/preferences` resource, fed into `get_meal_planning_context`.

**Why it's good:** Every downstream suggestion gets better — meal plans that don't propose shellfish to an allergic user, portion math scaled to household size. It's also the pattern this codebase is best at: a small storage class, a CRUD tool, and a resource, exactly like pantry/equipment. Low risk, compounding payoff.

**How:** Follow the `PantryStorage` pattern end-to-end: storage class, `manage_preferences` tool with `readOnlyHint: false` / `openWorldHint: false`, resource registration in `src/tools/resources.ts`, tests in `tests/tools/` and `tests/utils/`.

**Depends on:** Nothing. Pure additive.

### 6. Multi-store price comparison

**What:** Compare a shopping list's cost across two or three nearby stores, reusing the parallel-search pattern.

**Why it's good:** Kroger prices genuinely vary by store, and the data is reachable today — `search_products` already accepts a location filter. The bulk-parallel design rule for `search_products` (1–10 terms, `Promise.all()`, progress notifications) extends naturally to "same terms × N locations."

**How:** A `compare_store_prices` tool that fans out existing product searches across locations and returns a per-store total plus per-item best-store breakdown. Pairs well with a comparison-table view.

**Watch out for:** Request volume (list size × stores); cap at ~3 stores and reuse the progress-notification machinery so long runs feel responsive.

---

## Tier 3 — Infrastructure and polish

### 7. Cron-cached weekly deals

**What:** A Cloudflare cron trigger that pre-fetches and caches the QFC weekly ad in KV; `get_weekly_deals` reads the cache.

**Why it's good:** The fetch-and-augment in `qfc-weekly-deals.ts` is the slowest call in the repo, and the underlying data changes once a week. Caching makes `get_weekly_deals` fast and makes #1 (deal-aware planning) viable without adding seconds to every meal-planning call.

**How:** `scheduled` handler in the Worker, weekly cron in `wrangler.jsonc`, cache key with the ad's week identifier, fall back to live fetch on cache miss. Cache is global, not per-user.

### 8. Interactive shopping-list view

**What:** Upgrade the shopping-list view so users can check off, remove, and adjust quantities directly in the UI, with actions flowing back through the MCP Apps action bridge.

**Why it's good:** A shopping list is the one surface users want to _touch_ rather than talk at — checking items off in conversation is clumsy. The view plumbing (`views/app/views/`, shared components, `_view` routing) already exists; this is the natural next step for the MCP Apps investment.

**How:** Add focused shopping-list editing tools for check-off, removal, and quantity adjustment; update the dev harness mocks in `views/dev/`; keep structured content aligned with tool-local output schemas.

### 9. Workflow prompts

**What:** A small set of MCP prompts encoding end-to-end workflows: "weekly shop" (deals → meal plan → pantry-reconciled list → cart), "restock check," "clean out the pantry" (plan meals around what's expiring).

**Why it's good:** Cheap to build (`src/prompts.ts` exists and is thin) and high leverage for discoverability — prompts are how MCP clients surface "what can this server do?" Multi-tool workflows are exactly what users won't compose by hand.

**Depends on:** Most valuable after Tier 1 lands, since the workflows it encodes are #1–#3.

---

## Explicitly not planned

- **Coupon clipping, pickup time slots, nutrition data** — not in the Kroger public API. Reaching them means expanding the scraping approach beyond the weekly ad, which is fragile and likely against terms. Revisit only if Kroger expands the public API.
- **Server-side LLM calls in `get_meal_planning_context`** — MCP Sampling was deliberately removed; the host model does the reasoning. Keep it that way.
- **Order placement / payment** — `add_shopping_list_to_cart` fills the cart; the human completes the purchase. The trust boundary is correct as-is.

## Suggested sequencing

1. **#7 (deals cron)** first — small, independent, and it unblocks the headline feature.
2. **#1 (deal-aware planning)** and **#2 (pantry-aware lists)** next — these are the product's core loop.
3. **#5 (preferences)** and **#3 (restock)** — compounding context for everything above.
4. **#4 (price history)**, **#6 (store comparison)**, **#8 (interactive list)**, **#9 (prompts)** as follow-ons, in whatever order interest dictates.

Every feature lands with tests per `AGENTS.md` — new tools, storage classes, and branches all need coverage before handing back.

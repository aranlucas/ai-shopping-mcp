# Weekly Deals Category Ordering — Design

**Date:** 2026-07-12
**Status:** Approved

## Problem

`get_weekly_deals` returns deals in whatever order the source produced them
(DACS print-ad page order, or Product Search API result order). There's no
grouping, so meat, produce, and pantry items are interleaved. The user wants
deals grouped and ordered so protein-based deals (the anchor of a meal) come
first, followed by produce, then supporting categories, with miscellaneous
items last — both in the tool's markdown text and in the MCP Apps card grid.

## Investigation

Checked whether either data source already carries department/category info
that could drive grouping without new logic:

- **Primary path (DACS print-ad parsing, `normalizePrintDeals` in
  `src/services/qfc-weekly-deals.ts`)** — fetched a live QFC circular and page
  directly (division 705, print eventId `fef7e80e-...`). The raw
  `mapConfig.content` object only ever contains
  `{ contentId, headline, bodyCopy, id, offerVersionProductGroupId, imageURL, webUrl, appUrl, stores }`.
  No category or department field exists at all. This is the primary/default
  source, so most `get_weekly_deals` responses have zero category metadata to
  work with.
- **Fallback path (Kroger Product Search API, `fetchDealsBySearchApi`)** —
  `product.categories?.[0]` is already read into `NormalizedWeeklyDeal.department`,
  but this path only runs when print-ad parsing fails, and `department` is
  currently dropped in `formatWeeklyDealsToolResponse` before it reaches the
  model or the view.

Conclusion: category data isn't reliably available from either source, so
grouping must be derived from the deal title text itself, uniformly for both
source modes.

## Decisions

| Decision                 | Choice                                                                                                                                                                                                                                                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Classification mechanism | New deterministic keyword classifier over the deal title (`src/utils/deal-category.ts`), not a `department` lookup. Runs identically for `search_api` and `print_fallback` sourced deals.                                                                                                                                                          |
| Category list & order    | `Meat & Seafood` → `Produce` → `Dairy & Eggs` → `Bakery` → `Frozen` → `Pantry, Snacks & Beverages` → `Other` (catch-all default).                                                                                                                                                                                                                  |
| Where sorting happens    | `formatWeeklyDealsToolResponse` (`src/tools/weekly-deals.ts`) classifies and stably sorts `deals` into category order once; both the markdown text and `structuredContent` consume the same sorted+categorized array.                                                                                                                              |
| Markdown shape           | `formatWeeklyDealsMarkdown` groups consecutive same-category deals under a plain `Category Name:` label line (no `#`/`##` heading syntax — matches the existing `hours:`/`variants:` label convention in this file, saves tokens vs. a markdown heading) instead of one flat list. Deal line format (`formatWeeklyDealLineMarkdown`) is unchanged. |
| structuredContent shape  | `DealData` gains a required `category: string` field. `WeeklyDealsContent.deals` stays a flat array (already sorted by category) — no nested groups shape, to minimize view/type churn.                                                                                                                                                            |
| View rendering           | `weekly-deals.tsx` groups the (already-sorted) flat `deals` array by consecutive matching `category` client-side and renders a section header + grid per group, reusing the existing `SectionHeader` component.                                                                                                                                    |
| Unclassifiable deals     | Fall into `Other`, always last — never dropped, never erroring.                                                                                                                                                                                                                                                                                    |

## Design

### 1. `src/utils/deal-category.ts` (new)

```ts
export const DEAL_CATEGORIES = [
  "Meat & Seafood",
  "Produce",
  "Dairy & Eggs",
  "Bakery",
  "Frozen",
  "Pantry, Snacks & Beverages",
  "Other",
] as const;

export type DealCategory = (typeof DEAL_CATEGORIES)[number];

export function classifyDealCategory(title: string): DealCategory;
```

Implementation: for each category (in the order above, excluding `Other`), a
list of lowercase keyword phrases (single or multi-word, e.g. `"ice cream"`,
`"ground beef"`). `classifyDealCategory` lowercases the title once and tests
each category's keywords with a word-boundary regex
(`\bphrase\b`, phrase escaped), returning the first category with a match.
No match → `"Other"`.

Keyword lists are seeded from the existing `DEAL_SEARCH_TERMS` in
`qfc-weekly-deals.ts` (chicken, beef, milk, bread, frozen, juice, snack,
vegetable, seafood, cereal) plus real deal titles pulled from a live QFC
circular during design, e.g.: "Flank Steaks", "Fresh Wild-Caught Alaska
Sockeye Salmon Fillets", "Oscar Mayer Beef Franks", "Hempler's Bacon" →
Meat & Seafood; "Zucchini or Yellow Squash", "California Red or Black Plums",
"Washington Grown Rainier Cherries" → Produce; "Kroger Cheese", "Ellenos Greek
Yogurt" → Dairy & Eggs; "Franz Wide Pan Bread" → Bakery; "Popsicle Ice Pops",
"Bibigo or Pagoda Entrée" → Frozen; "General Mills Cereal", "Doritos",
"Private Selection Pasta", "Lipton Tea", "Coca-Cola", "Kendall-Jackson ...
Chard" → Pantry, Snacks & Beverages.

This is a pure, synchronous, dependency-free function — easy to unit test
directly with a table of title → expected category.

### 2. `src/tools/weekly-deals.ts` — `formatWeeklyDealsToolResponse`

After building the existing `deals` mapped array, attach `category` via
`classifyDealCategory(deal.title)` and stably sort by
`DEAL_CATEGORIES.indexOf(category)`. `Array.prototype.sort` in V8/Workers is
stable, so within a category, source order is preserved. Both
`formatWeeklyDealsMarkdown(...)` and `structuredContent.deals` use this same
sorted array — one source of truth, no duplicate classification.

### 3. `src/utils/format-response.ts` — `formatWeeklyDealsMarkdown`

`WeeklyDealMarkdownItem` gains `category: string`. The function walks the
<<<<<<< HEAD
(already sorted) deals array once, emitting a `{category}:` label line
whenever the category changes from the previous deal, then that deal's
existing `formatWeeklyDealLineMarkdown` line. Label line only appears when
there's at least one deal in that category — no empty-category labels. The
`dealCount`/`warnings` header lines are unchanged.

Note: this deliberately uses a plain `{category}:` line rather than a
markdown heading (`###`/`##`) — the `#` heading syntax costs tokens without
adding parseable value for a small host model, and the codebase already
prefers plain label lines for sub-sections (`hours:` in
`formatStoreHoursMarkdown`, `variants:` in `formatProductDetailMarkdown`).
`formatSearchProductsMarkdown`'s existing `## {term}` heading is a
pre-existing exception with its own calibrated token budget
(`tests/evals/token-budget.eval.test.ts`) and locked-in test assertions
(`tests/utils/format-response.test.ts`, `tests/tools/storage-backed-tools.test.ts`)
— out of scope here; changing it is a separate follow-up.

=======
(already sorted) deals array once, emitting a `### {category}` line whenever
the category changes from the previous deal, then that deal's existing
`formatWeeklyDealLineMarkdown` line. Header line only appears when there's at
least one deal in that category — no empty-category headers. The
`dealCount`/`warnings` header lines are unchanged.

> > > > > > > 21e64b7 (docs: add weekly deals category ordering design)
> > > > > > > Example:

```
Deals valid 2026-07-08 to 2026-07-15. dealCount: 6
<<<<<<< HEAD
Meat & Seafood:
- Flank Steaks | $6.99/lb | Save $2.00 (was $8.99/lb)
- Fresh Wild-Caught Alaska Sockeye Salmon Fillets | $9.99/lb
Produce:
- Zucchini or Yellow Squash | 2/$3.00
Dairy & Eggs:
- Kroger Cheese | $3.49
Pantry, Snacks & Beverages:
=======
### Meat & Seafood
- Flank Steaks | $6.99/lb | Save $2.00 (was $8.99/lb)
- Fresh Wild-Caught Alaska Sockeye Salmon Fillets | $9.99/lb
### Produce
- Zucchini or Yellow Squash | 2/$3.00
### Dairy & Eggs
- Kroger Cheese | $3.49
### Pantry, Snacks & Beverages
>>>>>>> 21e64b7 (docs: add weekly deals category ordering design)
- Doritos | 2/$6.00
- Coca-Cola | $5.99
```

### 4. `views/shared/types.ts`

`DealData` gains `category: string` (required, matches the tool always
setting it). `WeeklyDealsContent.deals` type is otherwise unchanged.

### 5. `views/app/views/weekly-deals.tsx`

`WeeklyDealsView` groups the flat `deals` array into consecutive runs by
`category` (a simple linear scan — the array already arrives sorted), and
renders one `SectionHeader`-style category heading + one deal grid per group,
in array order (which is category-priority order). `DealCard` itself is
unchanged. Empty-deals state is unchanged.

### 6. Testing

- `tests/utils/deal-category.test.ts` (new): table-driven tests covering each
  category's representative titles (including the real titles collected
  above), the `Other` fallback for an unrecognized title, and a couple of
  ambiguous/edge titles (empty string, multi-category phrase — first-match
  wins per the fixed category priority order).
- `tests/tools/weekly-deals.test.ts`: extend `formatWeeklyDealsToolResponse`
  tests to assert deals come back grouped/sorted (e.g. a fixture with produce
  listed before meat in source order asserts meat appears first in both the
  markdown text and `structuredContent.deals`), and that each
  `structuredContent` deal has a `category`.
- `tests/utils/format-response.test.ts` (existing file): add a case for
  `formatWeeklyDealsMarkdown` grouping/headers.
- No new view test infra exists for weekly deals currently; the view change
  is manually verified via `pnpm build:views` plus the dev harness
  (`views/dev/`) with mock data updated to include `category`.

## Non-goals

- No change to how deals are discovered/scraped/augmented (source order,
  print-ad parsing, search API terms) — this is purely a presentation-layer
  grouping on top of existing `NormalizedWeeklyDeal` data.
- No use of Workers AI / embeddings for classification — keyword matching is
  sufficient, free, and instant, consistent with `deal-match.ts`'s existing
  approach for a related problem.
- No per-user customization of category order.

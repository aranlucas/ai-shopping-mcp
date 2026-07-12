# Weekly Deals Category Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `get_weekly_deals` groups and orders deals by category (Meat & Seafood → Produce → Dairy & Eggs → Bakery → Frozen → Pantry, Snacks & Beverages → Other) in both the markdown tool response and the MCP Apps card grid, so protein deals anchor the list and meal planning flows naturally from them.

**Architecture:** A new pure, synchronous keyword classifier (`src/utils/deal-category.ts`) assigns each deal a category from its title. `formatWeeklyDealsToolResponse` classifies and stably sorts deals once; the markdown formatter and `structuredContent` both consume that single sorted+categorized array. The React view groups the (already-sorted) flat array into consecutive same-category runs for rendering.

**Tech Stack:** TypeScript, Vitest (`@cloudflare/vitest-pool-workers`), Zod v4, React (MCP Apps view).

## Global Constraints

- No `any` — use explicit types (see `docs/superpowers/specs/2026-07-12-weekly-deals-category-ordering-design.md`).
- New model-facing markdown must not use `#`/`##`/`###` heading syntax — use plain `Label:` lines (matches `hours:`/`variants:` convention already in `src/utils/format-response.ts`).
- Run the narrowest relevant test while iterating; run `pnpm build` and `pnpm test` before considering the plan done.
- If a view's `structuredContent` shape changes, update `views/dev/mock-data.ts` and run `pnpm build:views` (or `pnpm build`).
- Every new tool/handler/branch needs a test (per `AGENTS.md`).

---

### Task 1: `classifyDealCategory` keyword classifier

**Files:**

- Create: `src/utils/deal-category.ts`
- Test: `tests/utils/deal-category.test.ts`

**Interfaces:**

- Consumes: nothing (pure module, no imports from the rest of the codebase).
- Produces: `DEAL_CATEGORIES: readonly string[]` (the 7 category names in priority order, `"Other"` last), `DealCategory` (union type of those names), `classifyDealCategory(title: string): DealCategory`. Task 2 imports `DEAL_CATEGORIES` and `classifyDealCategory` from `../utils/deal-category.js`; Task 3 imports the `DealCategory` type only if needed (it isn't — `WeeklyDealMarkdownItem.category` is typed `string`).

- [ ] **Step 1: Write the failing test**

Create `tests/utils/deal-category.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { DEAL_CATEGORIES, classifyDealCategory } from "../../src/utils/deal-category.js";

describe("DEAL_CATEGORIES", () => {
  it("lists categories in meal-planning priority order, ending with Other", () => {
    expect(DEAL_CATEGORIES).toEqual([
      "Meat & Seafood",
      "Produce",
      "Dairy & Eggs",
      "Bakery",
      "Frozen",
      "Pantry, Snacks & Beverages",
      "Other",
    ]);
  });
});

describe("classifyDealCategory", () => {
  const cases: Array<[string, string]> = [
    // Meat & Seafood
    ["Fresh Coastal Range Organic Boneless Chicken Full Line Sale", "Meat & Seafood"],
    ["Oscar Mayer Beef Franks", "Meat & Seafood"],
    ["Hempler's Bacon", "Meat & Seafood"],
    ["Flank Steaks", "Meat & Seafood"],
    ["Fresh Wild-Caught Alaska Sockeye Salmon Fillets", "Meat & Seafood"],
    // Produce
    ["California Red or Black Plums", "Produce"],
    ["Zucchini or Yellow Squash", "Produce"],
    ["Washington Grown Rainier Cherries", "Produce"],
    ["California Red, Green or Black Seedless Grapes", "Produce"],
    ["Personal Watermelon", "Produce"],
    // Dairy & Eggs
    ["Ellenos Greek Yogurt", "Dairy & Eggs"],
    ["Kroger Cheese", "Dairy & Eggs"],
    // Bakery
    ["Franz Wide Pan Bread", "Bakery"],
    // Frozen
    ["Bibigo or Pagoda Entrée", "Frozen"],
    ["Popsicle Ice Pops", "Frozen"],
    // Pantry, Snacks & Beverages
    ["Lipton Tea", "Pantry, Snacks & Beverages"],
    ["Canada Dry", "Pantry, Snacks & Beverages"],
    ["General Mills Cereal", "Pantry, Snacks & Beverages"],
    ["Doritos", "Pantry, Snacks & Beverages"],
    ["Vitaminwater", "Pantry, Snacks & Beverages"],
    ["Starbucks Frappuccino", "Pantry, Snacks & Beverages"],
    ["Polar Seltzer Water", "Pantry, Snacks & Beverages"],
    ["Body Armor", "Pantry, Snacks & Beverages"],
    [
      "Kendall-Jackson VR Chard, Sauvignon Blanc, Avant or Pinot Gris",
      "Pantry, Snacks & Beverages",
    ],
    ["Coca-Cola", "Pantry, Snacks & Beverages"],
    ["Stumptown Coffee", "Pantry, Snacks & Beverages"],
    ["Private Selection Pasta", "Pantry, Snacks & Beverages"],
    ["Powerade", "Pantry, Snacks & Beverages"],
    ["Modelo, Elysian or White Claw Hard Seltzer", "Pantry, Snacks & Beverages"],
    ["Pepsi", "Pantry, Snacks & Beverages"],
  ];

  it.each(cases)("classifies %j as %j", (title, expected) => {
    expect(classifyDealCategory(title)).toBe(expected);
  });

  it("falls back to Other for an unrecognized title", () => {
    expect(classifyDealCategory("Widget Deluxe 3000")).toBe("Other");
  });

  it("falls back to Other for an empty title", () => {
    expect(classifyDealCategory("")).toBe("Other");
  });

  it("is case-insensitive", () => {
    expect(classifyDealCategory("GROUND BEEF")).toBe("Meat & Seafood");
  });

  it("does not match a keyword that's a substring of a longer word", () => {
    // "Popcorn" must not match the "corn" Produce keyword via substring
    // containment — word-boundary matching requires "corn" as its own word.
    expect(classifyDealCategory("Popcorn Tin")).toBe("Other");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/utils/deal-category.test.ts`
Expected: FAIL — `Cannot find module '../../src/utils/deal-category.js'`

- [ ] **Step 3: Write the implementation**

Create `src/utils/deal-category.ts`:

```ts
/**
 * Deterministic keyword classifier that groups weekly-deal titles into meal-
 * planning categories. Neither deal source carries reliable category data:
 * the primary DACS print-ad path has no department field at all, and the
 * Product Search fallback's `categories` field is dropped before this point.
 * See docs/superpowers/specs/2026-07-12-weekly-deals-category-ordering-design.md.
 */

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

type KeywordCategory = Exclude<DealCategory, "Other">;

const CATEGORY_KEYWORDS: Record<KeywordCategory, string[]> = {
  "Meat & Seafood": [
    "chicken",
    "beef",
    "pork",
    "turkey",
    "ham",
    "bacon",
    "sausage",
    "steak",
    "steaks",
    "ribs",
    "brisket",
    "ground beef",
    "flank",
    "sirloin",
    "wing",
    "wings",
    "meat",
    "salmon",
    "shrimp",
    "seafood",
    "fish",
    "tilapia",
    "cod",
    "crab",
    "tuna",
    "franks",
    "hot dog",
    "hot dogs",
    "pepperoni",
  ],
  Produce: [
    "apple",
    "apples",
    "banana",
    "bananas",
    "orange",
    "oranges",
    "grape",
    "grapes",
    "berry",
    "berries",
    "strawberry",
    "strawberries",
    "blueberry",
    "blueberries",
    "melon",
    "watermelon",
    "cherry",
    "cherries",
    "plum",
    "plums",
    "peach",
    "peaches",
    "pear",
    "pears",
    "lemon",
    "lemons",
    "lime",
    "limes",
    "avocado",
    "avocados",
    "tomato",
    "tomatoes",
    "potato",
    "potatoes",
    "onion",
    "onions",
    "pepper",
    "peppers",
    "lettuce",
    "spinach",
    "broccoli",
    "carrot",
    "carrots",
    "cucumber",
    "cucumbers",
    "zucchini",
    "squash",
    "corn",
    "mushroom",
    "mushrooms",
    "celery",
    "cabbage",
    "kale",
    "produce",
    "vegetable",
    "vegetables",
    "fruit",
    "salad",
  ],
  "Dairy & Eggs": [
    "milk",
    "cheese",
    "yogurt",
    "yoghurt",
    "egg",
    "eggs",
    "butter",
    "creamer",
    "cottage cheese",
    "sour cream",
    "half and half",
  ],
  Bakery: [
    "bread",
    "bun",
    "buns",
    "bagel",
    "bagels",
    "muffin",
    "muffins",
    "cake",
    "donut",
    "donuts",
    "tortilla",
    "tortillas",
    "roll",
    "rolls",
    "pastry",
    "bakery",
    "pie crust",
  ],
  Frozen: [
    "frozen",
    "ice cream",
    "popsicle",
    "popsicles",
    "ice pop",
    "ice pops",
    "waffle",
    "waffles",
    "entree",
  ],
  "Pantry, Snacks & Beverages": [
    "soda",
    "cola",
    "water",
    "juice",
    "coffee",
    "tea",
    "cereal",
    "pasta",
    "rice",
    "sauce",
    "chip",
    "chips",
    "cracker",
    "crackers",
    "snack",
    "snacks",
    "cookie",
    "cookies",
    "candy",
    "soup",
    "beer",
    "wine",
    "seltzer",
    "sports drink",
    "energy drink",
    "drink",
    "drinks",
    "ketchup",
    "mustard",
    "mayo",
    "oil",
    "spice",
    "granola",
    "nuts",
    "chard",
    "sauvignon",
    "pinot",
    "doritos",
    "pepsi",
    "powerade",
    "vitaminwater",
    "body armor",
    "frappuccino",
    "canada dry",
  ],
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CATEGORY_PATTERNS: Array<{ category: KeywordCategory; pattern: RegExp }> = (
  Object.entries(CATEGORY_KEYWORDS) as Array<[KeywordCategory, string[]]>
).map(([category, keywords]) => ({
  category,
  pattern: new RegExp(`\\b(?:${keywords.map(escapeRegExp).join("|")})\\b`),
}));

/** Lowercase and strip diacritics so accented titles (e.g. "Entrée") match ASCII keywords. */
function normalizeTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Classifies a weekly-deal title into a meal-planning category by testing
 * word-boundary keyword matches in priority order (DEAL_CATEGORIES order,
 * excluding "Other"). Falls back to "Other" when nothing matches. Pure and
 * synchronous — safe to call for every deal on every request.
 */
export function classifyDealCategory(title: string): DealCategory {
  const normalized = normalizeTitle(title);
  for (const { category, pattern } of CATEGORY_PATTERNS) {
    if (pattern.test(normalized)) return category;
  }
  return "Other";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/utils/deal-category.test.ts`
Expected: PASS (all cases, including the 28 real-title cases, the two `Other` fallbacks, the case-insensitivity check, and the substring false-positive check)

- [ ] **Step 5: Commit**

```bash
git add src/utils/deal-category.ts tests/utils/deal-category.test.ts
git commit -m "feat: add weekly-deal keyword category classifier"
```

---

### Task 2: Classify and sort deals in `formatWeeklyDealsToolResponse`

**Files:**

- Modify: `src/tools/weekly-deals.ts:12` (import), `src/tools/weekly-deals.ts:300-307` (the `deals` mapping inside `formatWeeklyDealsToolResponse`)
- Test: `tests/tools/weekly-deals.test.ts`

**Interfaces:**

- Consumes: `DEAL_CATEGORIES`, `classifyDealCategory` from `../utils/deal-category.js` (Task 1).
- Produces: `formatWeeklyDealsToolResponse`'s returned `structuredContent.deals` entries now include `category: string`, and the array is sorted into category-priority order (stable — same-category deals keep source order). Task 3's `formatWeeklyDealsMarkdown` receives this same sorted, categorized array.

- [ ] **Step 1: Write the failing tests**

In `tests/tools/weekly-deals.test.ts`, add inside the existing `describe("formatWeeklyDealsToolResponse", ...)` block (after the last existing `it`, before the closing `});` at line 393):

```ts
it("classifies and sorts deals into category order (meat before produce before pantry)", async () => {
  const result = makeMinimalResult({
    deals: [
      { id: "1", title: "Zucchini", price: "$1.99", source: "print" },
      { id: "2", title: "Flank Steaks", price: "$6.99/lb", source: "print" },
      { id: "3", title: "Doritos", price: "$3.99", source: "print" },
    ],
  });
  const response = formatWeeklyDealsToolResponse(result, "miss");
  const text = getTextContent(response);

  const meatIndex = text.indexOf("Flank Steaks");
  const produceIndex = text.indexOf("Zucchini");
  const pantryIndex = text.indexOf("Doritos");
  expect(meatIndex).toBeGreaterThan(-1);
  expect(meatIndex).toBeLessThan(produceIndex);
  expect(produceIndex).toBeLessThan(pantryIndex);
  expect(text).toContain("Meat & Seafood:");
  expect(text).toContain("Produce:");
  expect(text).toContain("Pantry, Snacks & Beverages:");

  const structured = response.structuredContent as {
    deals: Array<{ title: string; category: string }>;
  };
  expect(structured.deals.map((d) => d.title)).toEqual(["Flank Steaks", "Zucchini", "Doritos"]);
  expect(structured.deals.map((d) => d.category)).toEqual([
    "Meat & Seafood",
    "Produce",
    "Pantry, Snacks & Beverages",
  ]);
});

it("keeps deals within the same category in their original (source) order", async () => {
  const result = makeMinimalResult({
    deals: [
      { id: "1", title: "Chicken Breast", price: "$3.99/lb", source: "print" },
      { id: "2", title: "Ground Beef", price: "$4.99/lb", source: "print" },
    ],
  });
  const response = formatWeeklyDealsToolResponse(result, "miss");
  const structured = response.structuredContent as { deals: Array<{ title: string }> };
  expect(structured.deals.map((d) => d.title)).toEqual(["Chicken Breast", "Ground Beef"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/tools/weekly-deals.test.ts -t "classifies and sorts deals"`
Expected: FAIL — `structured.deals[0].category` is `undefined`, and/or the text order doesn't have `Flank Steaks` before `Zucchini` (source order was Zucchini, Flank Steaks, Doritos), and/or `Meat & Seafood:` label is missing from the text.

- [ ] **Step 3: Implement**

In `src/tools/weekly-deals.ts`, update the import (line 12):

```ts
import { formatWeeklyDealsMarkdown } from "../utils/format-response.js";
```

becomes:

```ts
import { DEAL_CATEGORIES, classifyDealCategory } from "../utils/deal-category.js";
import { formatWeeklyDealsMarkdown } from "../utils/format-response.js";
```

(keep the two import lines in that relative order — `deal-category.js` sorts before `format-response.js` alphabetically, matching this file's existing import grouping/ordering convention.)

Replace the `deals` mapping (originally lines 300-307):

```ts
const deals = result.deals.map((deal) => ({
  title: deal.title,
  details: deal.details,
  price: deal.price,
  savings: deal.savings,
  validFrom: deal.validFrom,
  validTill: deal.validTill,
}));
```

with:

```ts
const deals = result.deals
  .map((deal) => ({
    title: deal.title,
    details: deal.details,
    price: deal.price,
    savings: deal.savings,
    validFrom: deal.validFrom,
    validTill: deal.validTill,
    category: classifyDealCategory(deal.title),
  }))
  .sort((a, b) => DEAL_CATEGORIES.indexOf(a.category) - DEAL_CATEGORIES.indexOf(b.category));
```

(`Array.prototype.sort` is stable per spec, so this only reorders across categories — deals within the same category keep their original relative order.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/tools/weekly-deals.test.ts`
Expected: PASS — all pre-existing tests in this file still pass (they use `toContain`, unaffected by the new category label lines), plus the two new tests.

- [ ] **Step 5: Commit**

```bash
git add src/tools/weekly-deals.ts tests/tools/weekly-deals.test.ts
git commit -m "feat: classify and sort weekly deals by category"
```

---

### Task 3: Group deals under category labels in `formatWeeklyDealsMarkdown`

**Files:**

- Modify: `src/utils/format-response.ts:319-356` (`WeeklyDealMarkdownItem`, `formatWeeklyDealsMarkdown`)
- Test: `tests/utils/format-response.test.ts`

**Interfaces:**

- Consumes: nothing new — `formatWeeklyDealsMarkdown` is called by Task 2's already-modified `formatWeeklyDealsToolResponse` with objects that now include `category: string` (matching the field this task adds to `WeeklyDealMarkdownItem`).
- Produces: `WeeklyDealMarkdownItem` now requires `category: string`. `formatWeeklyDealLineMarkdown`'s signature and output are unchanged (it still ignores `category` — the label line is emitted separately by `formatWeeklyDealsMarkdown`).

- [ ] **Step 1: Write the failing tests**

In `tests/utils/format-response.test.ts`, update the two existing literals in the `describe("formatWeeklyDealsMarkdown", ...)` block (around line 455-470) to include `category`, since the type now requires it:

```ts
it("includes a validity header and dealCount when both dates are present", () => {
  const text = formatWeeklyDealsMarkdown(
    [
      {
        title: "Ground Beef",
        details: "80% Lean",
        price: "$3.99/lb",
        savings: "Save $2.00",
        category: "Meat & Seafood",
      },
    ],
    "2026-06-25",
    "2026-07-01",
  );
  expect(text).toContain("Deals valid 2026-06-25 to 2026-07-01. dealCount: 1");
  expect(text).toContain("- Ground Beef | 80% Lean | $3.99/lb | Save $2.00");
});

it("falls back to a bare dealCount header when dates are missing", () => {
  const text = formatWeeklyDealsMarkdown([{ title: "Bananas", category: "Produce" }]);
  expect(text).toContain("dealCount: 1");
  expect(text).not.toContain("Deals valid");
});
```

(The `"includes warnings when present"` and `"handles an empty deals array"` tests pass an empty `[]` array — no change needed there, since an empty array typechecks regardless of item shape.)

Then add a new `it` in the same `describe` block, after the existing four, for the grouping behavior itself:

```ts
it("groups consecutive deals under a category label, without repeating it", () => {
  const text = formatWeeklyDealsMarkdown([
    { title: "Flank Steaks", price: "$6.99/lb", category: "Meat & Seafood" },
    { title: "Ground Beef", price: "$4.99/lb", category: "Meat & Seafood" },
    { title: "Zucchini", price: "$1.99", category: "Produce" },
  ]);
  const lines = text.split("\n");
  expect(lines).toEqual([
    "dealCount: 3",
    "Meat & Seafood:",
    "- Flank Steaks | $6.99/lb",
    "- Ground Beef | $4.99/lb",
    "Produce:",
    "- Zucchini | $1.99",
  ]);
});

it("does not use markdown heading syntax for category labels", () => {
  const text = formatWeeklyDealsMarkdown([
    { title: "Flank Steaks", price: "$6.99/lb", category: "Meat & Seafood" },
  ]);
  expect(text).not.toContain("#");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/utils/format-response.test.ts -t "formatWeeklyDealsMarkdown"`
Expected: FAIL — TypeScript compile error first (`category` missing is not actually a runtime failure in Vitest/esbuild, which doesn't type-check on run, so instead expect these two new tests to fail on assertion: the grouping test fails because no `"Meat & Seafood:"` label line is emitted yet).
Run `pnpm exec tsc --noEmit` afterward too — it will show the type errors for the two updated literals until Step 3 lands, confirming the test file is ahead of the implementation.

- [ ] **Step 3: Implement**

In `src/utils/format-response.ts`, replace the `WeeklyDealMarkdownItem` type and `formatWeeklyDealsMarkdown` function (originally lines 319-356):

```ts
/** Minimal shape formatWeeklyDealsMarkdown needs — matches QfcDealsApiResponse deal entries. */
export type WeeklyDealMarkdownItem = {
  title: string;
  details?: string;
  price?: string;
  savings?: string | null;
  category: string;
};

/** One markdown line for a weekly deal: title, details, price, savings. */
export function formatWeeklyDealLineMarkdown(deal: WeeklyDealMarkdownItem): string {
  const parts: string[] = [deal.title];
  if (deal.details) parts.push(deal.details);
  if (deal.price) parts.push(deal.price);
  if (deal.savings) parts.push(deal.savings);
  return `- ${parts.join(" | ")}`;
}

/**
 * Markdown for get_weekly_deals: header with validity window and deal count,
 * then deals grouped under a plain `{category}:` label line per category
 * change (deals arrive pre-sorted by category — see formatWeeklyDealsToolResponse).
 * Deliberately not a markdown heading (`#`/`##`/`###`): a plain label line
 * costs fewer tokens and matches this file's existing `hours:`/`variants:`
 * label convention.
 */
export function formatWeeklyDealsMarkdown(
  deals: WeeklyDealMarkdownItem[],
  validFrom?: string,
  validTill?: string,
  warnings?: string[],
): string {
  const lines: string[] = [
    validFrom && validTill
      ? `Deals valid ${validFrom} to ${validTill}. dealCount: ${deals.length}`
      : `dealCount: ${deals.length}`,
  ];

  if (warnings && warnings.length > 0) {
    lines.push(`warnings: ${warnings.join("; ")}`);
  }

  if (deals.length === 0) return lines.join("\n");

  let lastCategory: string | undefined;
  for (const deal of deals) {
    if (deal.category !== lastCategory) {
      lines.push(`${deal.category}:`);
      lastCategory = deal.category;
    }
    lines.push(formatWeeklyDealLineMarkdown(deal));
  }

  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/utils/format-response.test.ts`
Expected: PASS — all `formatWeeklyDealsMarkdown` tests, plus every other test in the file (unaffected).

Also run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/utils/format-response.ts tests/utils/format-response.test.ts
git commit -m "feat: group weekly-deals markdown output by category label"
```

---

### Task 4: Propagate `category` through view types and dev mock data

**Files:**

- Modify: `views/shared/types.ts:54-61` (`DealData`)
- Modify: `views/dev/mock-data.ts` (`mockWeeklyDeals`)

**Interfaces:**

- Consumes: nothing.
- Produces: `DealData.category: string` (required) — Task 5's `weekly-deals.tsx` reads `deal.category` to group the grid.

- [ ] **Step 1: Update the type**

In `views/shared/types.ts`, replace:

```ts
export type DealData = {
  title: string;
  details?: string;
  price?: string;
  savings?: string | null;
  validFrom?: string;
  validTill?: string;
};
```

with:

```ts
export type DealData = {
  title: string;
  details?: string;
  price?: string;
  savings?: string | null;
  validFrom?: string;
  validTill?: string;
  category: string;
};
```

- [ ] **Step 2: Update the dev mock data**

In `views/dev/mock-data.ts`, find `mockWeeklyDeals` (starts at line 35) and add a `category` to each of the 4 deal entries, matching what `classifyDealCategory` would actually produce for these titles (verified against Task 1's classifier: "Organic Whole Milk" → Dairy & Eggs via `milk`; "Boneless Chicken Breast" → Meat & Seafood via `chicken`; "Strawberries" → Produce via `strawberries`; "Sourdough Bread" → Bakery via `bread`). Reorder the array entries themselves to already be in category-priority order too, so the mock accurately represents what the real tool now returns:

```ts
export const mockWeeklyDeals: WeeklyDealsContent = {
  _view: "get_weekly_deals",
  validFrom: "2026-03-18",
  validTill: "2026-03-24",
  deals: [
    {
      title: "Boneless Chicken Breast",
      details: "Per lb, family pack",
      price: "$2.99/lb",
      savings: "Save $2.00/lb",
      category: "Meat & Seafood",
    },
    {
      title: "Strawberries",
      details: "1 lb clamshell",
      price: "$2.49",
      savings: "Save $1.00",
      category: "Produce",
    },
    {
      title: "Organic Whole Milk",
      details: "1 gallon, QFC Brand",
      price: "$3.99",
      savings: "Save $1.50",
      validFrom: "2026-03-18",
      validTill: "2026-03-24",
      category: "Dairy & Eggs",
    },
    {
      title: "Sourdough Bread",
      details: "24 oz loaf",
      price: "$4.49",
      savings: null,
      category: "Bakery",
    },
  ],
};
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit -p views/tsconfig.json`
Expected: no errors (this will fail before Task 5 is done only if some other file already destructures `DealData` without `category` in a way that requires it — check by running now; `weekly-deals.tsx` doesn't yet read `category`, so this should already pass since adding a required field to a type doesn't break code that doesn't construct that type from a narrower literal). If it does fail because `DealCard`'s prop type structurally requires exact match somewhere, fix in Task 5 instead — this step is a checkpoint, not a hard gate.

- [ ] **Step 4: Commit**

```bash
git add views/shared/types.ts views/dev/mock-data.ts
git commit -m "feat: add category field to weekly deals view types and mock data"
```

---

### Task 5: Group the weekly-deals card grid by category

**Files:**

- Modify: `views/app/views/weekly-deals.tsx`

**Interfaces:**

- Consumes: `DealData.category: string` (Task 4).
- Produces: no new exports — `WeeklyDealsView` is the module's only export and its props are unchanged.

- [ ] **Step 1: Implement grouping**

In `views/app/views/weekly-deals.tsx`, add a grouping helper above `WeeklyDealsView` (after the `DealCard` function, before `export function WeeklyDealsView`):

```ts
/** Groups a category-sorted deals array into consecutive same-category runs. */
function groupDealsByCategory(deals: DealData[]): Array<{ category: string; deals: DealData[] }> {
  const groups: Array<{ category: string; deals: DealData[] }> = [];
  for (const deal of deals) {
    const last = groups[groups.length - 1];
    if (last && last.category === deal.category) {
      last.deals.push(deal);
    } else {
      groups.push({ category: deal.category, deals: [deal] });
    }
  }
  return groups;
}
```

Add `DealData` to the existing type-only import from `../../shared/types.js`:

```ts
import {
  type DealData,
  type WeeklyDealsContent,
  callTool,
  sendUserMessage,
} from "../../shared/types.js";
```

Replace the grid render block (the `<div className="grid ...">{deals.map(...)}</div>` near the end of `WeeklyDealsView`, currently):

```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
  {deals.map((deal) => (
    <DealCard
      key={deal.title}
      deal={deal}
      canCallTools={canCallTools}
      onSearch={handleSearch}
      onPlanMeal={handlePlanMeal}
    />
  ))}
</div>
```

with:

```tsx
{
  groupDealsByCategory(deals).map((group) => (
    <div key={group.category} className="mb-5 last:mb-0">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
          {group.category}
        </span>
        <span className="text-[11px] text-gray-300">·</span>
        <span className="text-[11px] text-gray-400">
          {group.deals.length} item{group.deals.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {group.deals.map((deal) => (
          <DealCard
            key={deal.title}
            deal={deal}
            canCallTools={canCallTools}
            onSearch={handleSearch}
            onPlanMeal={handlePlanMeal}
          />
        ))}
      </div>
    </div>
  ));
}
```

(This follows the existing per-group label convention already used in `views/app/views/product-search.tsx` for grouping by search term — small uppercase-tracked label + item count, not `SectionHeader`, which is reserved for the page-level title.)

- [ ] **Step 2: Build and typecheck the views**

Run: `pnpm build:views`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 3: Note on manual visual verification**

`package.json` has no scripted entry point for `views/dev/dev-harness.tsx` today (only `build:views`, which builds `views/mcp-app.html`) — there's no `pnpm run <x>` that renders the dev harness in a browser as-is. Treat Step 2's clean `pnpm build:views` (typecheck + bundle of the real `mcp-app.html` entry, which includes `weekly-deals.tsx`) as the verification for this task. If a human wants a live visual check, they'd need to temporarily point Vite's `INPUT` env var at `dev/dev-harness.tsx` and serve it (e.g. `INPUT=dev/dev-harness.tsx pnpm exec vite`) — call this out to the user as an optional manual follow-up rather than doing it silently, since it's outside this plan's scope.

- [ ] **Step 4: Commit**

```bash
git add views/app/views/weekly-deals.tsx
git commit -m "feat: group weekly deals card grid by category"
```

---

### Task 6: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: all tests pass, including `pnpm eval:mcp` (run as part of `pnpm test` per `AGENTS.md`).

- [ ] **Step 2: Run the full build**

Run: `pnpm build`
Expected: succeeds — oxlint clean, views build, worker + views typecheck clean.

- [ ] **Step 3: Spot-check token/response-size budgets**

Run: `EVAL_LOG=1 pnpm eval:mcp`
Expected: no budget failures for `get_weekly_deals`-adjacent suites. If a token-budget assertion elsewhere unexpectedly references `get_weekly_deals` output size, recalibrate that specific number with a comment explaining the new category-label lines — per `AGENTS.md`, never bump numbers without justification.

- [ ] **Step 4: Report**

Confirm to the user: all tests pass, `pnpm build` is clean, and mention that live QFC data was used only for design research (Task 1's classifier and test fixtures), not wired into any test as a network call — all tests are fully offline/deterministic.

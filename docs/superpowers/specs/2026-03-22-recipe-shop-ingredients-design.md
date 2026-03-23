# Recipe "Shop Ingredients" Feature Design

**Date:** 2026-03-22
**Status:** Approved

## Overview

Add a "Shop Ingredients" button to each recipe card in `RecipeResultsView`. Clicking it searches for all ingredients and transitions to an in-view ingredient shopping screen, keeping recipe context visible with a back button. Pantry staples are searched too but surfaced separately in a collapsible section.

## Architecture

### View State in `RecipeResultsView`

`RecipeResultsView` gains a discriminated mode state:

```ts
type RecipeViewMode =
  | { mode: "recipes" }
  | {
      mode: "shopping";
      recipe: RecipeData;
      results: ProductSearchResultsContent | null;
      loading: boolean;
    };
```

- Default: `{ mode: "recipes" }` — renders the existing recipe card grid
- On "Shop Ingredients" click: sets `loading: true`, calls `search_products`, then sets full results
- "Show All Recipes" resets to `{ mode: "recipes" }`

Updated prop signature for `RecipeResultsView`:

```ts
{
  data: RecipeResultsContent;
  app: App | null;
  canCallTools: boolean;
}
```

`App` is imported from `@modelcontextprotocol/ext-apps/react` (consistent with other view files).

`App.tsx` must pass `app` and `canCallTools` to `RecipeResultsView` (currently neither are passed).

### ProductCard Extraction (Required Step)

`ProductCard` in `ProductSearch.tsx` is currently module-private. It **must be extracted** to `views/shared/components.tsx` and exported, so both `ProductSearchView` and `RecipeShoppingView` can use it. Its props interface and implementation stay the same.

### New File: `views/app/views/RecipeShoppingView.tsx`

```ts
function RecipeShoppingView({
  recipe,
  results,
  canCallTools,
  app,
  onBack,
}: {
  recipe: RecipeData;
  results: ProductSearchResultsContent;
  canCallTools: boolean;
  app: App | null; // from @modelcontextprotocol/ext-apps/react
  onBack: () => void;
});
```

Internally classifies each search result term as "main" or "pantry staple" (see below), then renders two sections.

### Component Structure

```
RecipeResultsView
├── mode === "recipes"    → RecipeCard grid (existing) + "Shop Ingredients" button per card
├── mode === "shopping" + loading → spinner ("Searching for ingredients…")
└── mode === "shopping" + results → RecipeShoppingView
    ├── Header ("Ingredients for X" + "← Show All Recipes")
    ├── Subtitle ("X products | Y pantry staples")
    ├── Main ingredient section (3-col grid)
    │   ├── Per ingredient: label + ProductCard (with individual Add to Cart / Save buttons)
    │   └── "No results" placeholder if term returned 0 products
    ├── [if >10 ingredients] "Not searched" list — remaining ingredient names as gray pills
    ├── Pantry staples section (collapsible)
    │   ├── Checkbox "Include Y pantry staples" + "Show/Hide Details" toggle
    │   └── Pantry staple ProductCards (hidden until "Show Details")
    └── Footer ("Estimated Recipe Total: $X.XX" + "Add All to Cart")
```

## `search_products` and `locationId`

The `search_products` server tool calls `safeResolveLocationId` which falls back to the user's saved preferred location when no `locationId` argument is provided. The `ToolCall` type in `types.ts` only includes `{ terms: string[] }` for `search_products`, which is correct — omitting `locationId` lets the server resolve it automatically.

No changes to `ToolCall` or `types.ts` are needed.

## Pantry Staple Classification

After `search_products` returns, each result term is classified by inspecting the **first product's `categories` array** (`result.products[0]?.categories`). A term is a pantry staple if any category matches a known staple category:

**Staple categories**: `"Spices & Seasonings"`, `"Baking"`, `"Baking Supplies"`, `"Condiments & Sauces"`, `"Pantry"`, `"Oils & Vinegars"`, `"Salt & Sugar"`

**Fallback heuristic** (used when the product has no categories): ingredient name contains any of: `salt`, `pepper`, `oil`, `butter`, `flour`, `sugar`, `water`, `baking soda`, `baking powder`, `vinegar`, `vanilla`.

**Failed terms** (`result.failed === true`): treated as "no results" — shown as a "No results found" placeholder card, excluded from both the main and staple counts in the subtitle.

Classification is done client-side after results arrive — no API changes needed.

## Ingredient → Search Term Mapping

Recipe ingredients have `quantity`, `unit`, `name`, `notes`. Only `name` is passed as the search term (e.g. `"boneless skinless chicken breasts"`, not `"1 lb boneless skinless chicken breasts"`).

`search_products` accepts 1–10 terms. If a recipe has more than 10 ingredients, use the **first 10 in recipe order** (recipes typically list main ingredients first). The remaining ingredients beyond 10 are shown as a "Not searched" section — a row of gray pills showing the full ingredient label (quantity+unit+name+notes), no product lookup. Same label format as the ingredient labels above product cards.

## Shopping View Details

### Header

- Left: "Ingredients for [Recipe Title]" (bold, truncated at 1 line)
- Right: "← Show All Recipes" text link that calls `onBack()`

### Subtitle

- `"X products | Y pantry staples"` where X = count of main (non-staple) terms with ≥1 result, Y = count of staple terms. Failed and "not searched" terms are excluded from both counts.

### Product Cards (per ingredient)

- Ingredient label above card: full original ingredient string (quantity+unit+name+notes, e.g. `"1 lb boneless skinless chicken breasts"`), gray, small
- Uses the extracted `ProductCard` from `views/shared/components.tsx`
- Shows first product only (first element of `result.products`)
- Individual "Add to Cart" and "Save" buttons per card, wired identically to `ProductSearchView` (single-item `add_to_cart` / `manage_shopping_list` calls). These coexist with the "Add All to Cart" footer — both remain active.
- If a term returned 0 results or `failed === true`: show a "No results found" placeholder (gray card, no actions)

### Pantry Staples Section

- Checkbox: "Include Y pantry staples" — when unchecked, hides staples from total and excludes their UPCs from "Add All to Cart"
- "Show Details" / "Hide Details" toggle — collapses/expands the staple product cards
- Default state: checkbox checked, details hidden

### Footer

- **Estimated Recipe Total**: sum of prices for all products with UPCs. Per product, use `product.items?.[0]?.price?.promo` when it is non-null and differs from `regular` (sale price), otherwise `product.items?.[0]?.price?.regular`. Exclude staples when their checkbox is unchecked. Show `—` if no prices available.
- **"Add All to Cart"** button: single `add_to_cart` call with all UPCs batched into the `items` array (`[{ upc, quantity: 1, modality: "PICKUP" }]`). Excludes products with no UPC and staples when unchecked. Disabled if `!canCallTools`.

### Loading State

While `search_products` is in-flight, show the existing `<Loading message="Searching for ingredients…" />` component in place of the shopping view.

### Error State

If the `callTool` call throws or returns `isError: true`: show an inline error message with a "Try again" button that re-triggers the search. Stay in shopping mode (don't reset to recipes).

## Changes to Existing Files

| File                                | Change                                                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `views/App.tsx`                     | Pass `app` and `canCallTools` to `RecipeResultsView`                                                                                                                |
| `views/app/views/RecipeResults.tsx` | Add mode state + props; add "Shop Ingredients" button to `RecipeCard` (only rendered when `recipe.ingredients?.length > 0`); import and render `RecipeShoppingView` |
| `views/app/views/ProductSearch.tsx` | Remove local `ProductCard`; import it from `views/shared/components.tsx`                                                                                            |
| `views/shared/components.tsx`       | Export extracted `ProductCard` component                                                                                                                            |

## New Files

| File                                     | Purpose                                                        |
| ---------------------------------------- | -------------------------------------------------------------- |
| `views/app/views/RecipeShoppingView.tsx` | Ingredient shopping view with pantry staple section and footer |

## Out of Scope

- Product images (not in `ProductData` type)
- Quantity adjustment per ingredient before adding to cart (all add as qty=1)
- Cross-referencing user's actual pantry KV data to auto-check pantry staples

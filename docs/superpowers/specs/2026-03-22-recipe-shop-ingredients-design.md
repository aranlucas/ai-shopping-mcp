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

`App.tsx` must pass `app` and `canCallTools` to `RecipeResultsView` (currently neither are passed).

### New File: `views/app/views/RecipeShoppingView.tsx`

Receives: `recipe: RecipeData`, `results: ProductSearchResultsContent`, `canCallTools: boolean`, `app: App | null`, `onBack: () => void`.

Internally classifies each search result term as "main" or "pantry staple" (see below), then renders two sections.

### Component Structure

```
RecipeResultsView
├── mode === "recipes"  → RecipeCard grid (existing)
└── mode === "shopping" → RecipeShoppingView
    ├── Header ("Ingredients for X" + "Show All Recipes")
    ├── Subtitle ("X products | Y pantry staples")
    ├── Main ingredient product cards (3-col grid)
    ├── Pantry staples section (collapsible)
    │   ├── Checkbox "Include Y pantry staples" + "Show/Hide Details" toggle
    │   └── Pantry staple product cards (hidden until toggled)
    └── Footer ("Estimated Total: $X.XX" + "Add All to Cart")
```

## Pantry Staple Classification

After `search_products` returns, each result term is classified by inspecting the **best-matched product's `categories` array**. A term is a pantry staple if any category matches a known staple category:

**Staple categories**: `"Spices & Seasonings"`, `"Baking"`, `"Baking Supplies"`, `"Condiments & Sauces"`, `"Pantry"`, `"Oils & Vinegars"`, `"Salt & Sugar"`

**Fallback heuristic** (used when product has no categories): ingredient name contains any of: `salt`, `pepper`, `oil`, `butter`, `flour`, `sugar`, `water`, `baking soda`, `baking powder`, `vinegar`, `vanilla`.

Classification is done client-side after results arrive — no API changes needed.

## Ingredient → Search Term Mapping

Recipe ingredients have `quantity`, `unit`, `name`, `notes`. Only `name` is passed as the search term (e.g. `"boneless skinless chicken breasts"` not `"1 lb boneless skinless chicken breasts"`).

`search_products` accepts 1–10 terms. If a recipe has more than 10 ingredients, search the first 10 by `name` length (shortest = most searchable). Remaining ingredients are shown as "not searched" in the UI.

## Shopping View Details

### Header

- Left: "Ingredients for [Recipe Title]" (bold, truncated at 1 line)
- Right: "← Show All Recipes" text link that calls `onBack()`

### Subtitle

- `"X products | Y pantry staples"` where X = main ingredient count with results, Y = staple count

### Product Cards (per ingredient)

- Ingredient label above card: `"1 lb boneless skinless chicken breasts"` (full original text, gray, small)
- Uses existing `ProductCard` component from `ProductSearch.tsx` (or extracts shared card)
- If a term returned 0 results: show a "No results found" placeholder card
- Shows first product only (best match from sorted results)

### Pantry Staples Section

- Checkbox: "Include Y pantry staples" — when unchecked, hides staples from total/Add All
- "Show Details" / "Hide Details" toggle — collapses/expands the staple product cards
- Default state: checkbox checked, details hidden

### Footer

- "Estimated Recipe Total: $X.XX" — sum of `items[0].price.regular` (or `promo` if available) for all products with UPCs, excluding unchecked staples
- "Add All to Cart" button — calls `add_to_cart` for all products with UPCs in parallel, disabled if `!canCallTools`

### Loading State

While `search_products` is in-flight, show a spinner in place of the shopping view with message "Searching for ingredients…"

## Changes to Existing Files

| File                                | Change                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| `views/App.tsx`                     | Pass `app` and `canCallTools` to `RecipeResultsView`                                   |
| `views/app/views/RecipeResults.tsx` | Add mode state, "Shop Ingredients" button to `RecipeCard`, import `RecipeShoppingView` |
| `views/shared/types.ts`             | No changes needed                                                                      |

## New Files

| File                                     | Purpose                                                        |
| ---------------------------------------- | -------------------------------------------------------------- |
| `views/app/views/RecipeShoppingView.tsx` | Ingredient shopping view with pantry staple section and footer |

## Error Handling

- If `search_products` call fails: show error message with "Try again" button, stay in shopping mode
- If `canCallTools` is false: disable "Add All to Cart" and per-product action buttons (consistent with `ProductSearchView`)
- Products with no UPC: excluded from "Add All to Cart" silently

## Out of Scope

- Product images (not in `ProductData` type)
- Quantity adjustment per ingredient before adding to cart (all add as qty=1)
- Cross-referencing user's actual pantry KV data to auto-check pantry staples

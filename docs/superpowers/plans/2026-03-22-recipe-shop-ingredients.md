# Recipe Shop Ingredients Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Shop Ingredients" button to each recipe card that searches for all recipe ingredients and transitions to an in-view ingredient shopping screen with pantry staple classification, estimated total, and "Add All to Cart."

**Architecture:** `RecipeResultsView` gains a discriminated mode state (`"recipes"` | `"shopping"`) and new `app`/`canCallTools` props. The shopping view is extracted to `RecipeShoppingView.tsx` which calls `search_products` via `callTool`, classifies results as main vs. pantry staple using product categories, and renders product cards grouped by ingredient. `ProductCard` is extracted from `ProductSearch.tsx` to `views/shared/components.tsx` for reuse.

**Tech Stack:** React 18, TypeScript, Tailwind CSS v4, Vite + `vite-plugin-singlefile`, `@modelcontextprotocol/ext-apps/react`

---

## File Map

| File                                     | Status     | Change                                                                             |
| ---------------------------------------- | ---------- | ---------------------------------------------------------------------------------- |
| `views/shared/components.tsx`            | Modify     | Add exported `ProductCard` (moved from `ProductSearch.tsx`)                        |
| `views/app/views/ProductSearch.tsx`      | Modify     | Remove local `ProductCard`, import from shared                                     |
| `views/App.tsx`                          | Modify     | Pass `app` and `canCallTools` to `RecipeResultsView`                               |
| `views/app/views/RecipeResults.tsx`      | Modify     | Add mode state + props, "Shop Ingredients" button, render `RecipeShoppingView`     |
| `views/app/views/RecipeShoppingView.tsx` | **Create** | Ingredient shopping view with staple classification, footer total, Add All to Cart |

---

## Task 1: Extract `ProductCard` to shared components

**Files:**

- Modify: `views/shared/components.tsx`
- Modify: `views/app/views/ProductSearch.tsx`

- [ ] **Step 1: Add `ProductCard` to `views/shared/components.tsx`**

Append the following to the end of `views/shared/components.tsx` (before the final closing):

```tsx
export function ProductCard({
  product,
  canCallTools,
  onAddToCart,
  onAddToList,
}: {
  product: ProductData;
  canCallTools: boolean;
  onAddToCart: (upc: string, qty: number) => Promise<void>;
  onAddToList: (name: string, upc: string) => Promise<void>;
}) {
  const name = product.description || "Unknown Product";
  const brand = product.brand;
  const upc = product.upc;
  const size = product.items?.[0]?.size;
  const aisle =
    product.aisleLocations?.[0]?.description ||
    (product.aisleLocations?.[0]?.number ? `Aisle ${product.aisleLocations[0].number}` : undefined);

  return (
    <div className="bg-[var(--app-card-bg)] rounded-lg border border-[var(--app-border)] hover:border-[var(--app-border-hover)] hover:shadow-sm transition-all duration-150 flex flex-col overflow-hidden">
      <div className="p-3 flex-1">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="font-medium text-[13px] text-gray-900 leading-snug">{name}</div>
            {(brand || size) && (
              <div className="text-[11px] text-gray-400 mt-0.5">
                {brand}
                {brand && size && " · "}
                {size}
              </div>
            )}
            {aisle && (
              <div className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-0.5">
                <svg
                  aria-hidden="true"
                  className="w-2.5 h-2.5 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"
                  />
                </svg>
                {aisle}
              </div>
            )}
          </div>
          <div className="shrink-0">
            <PriceDisplay product={product} />
          </div>
        </div>
        <FulfillmentTags product={product} />
        {upc && <div className="text-[9px] text-gray-300 mt-1 font-mono">{upc}</div>}
      </div>
      <ProductActions
        upc={upc}
        name={name}
        disabled={!canCallTools}
        onAddToCart={onAddToCart}
        onAddToList={onAddToList}
      />
    </div>
  );
}
```

- [ ] **Step 2: Update `views/app/views/ProductSearch.tsx` to import `ProductCard` from shared**

Remove the entire local `ProductCard` function (lines 16–89 in the current file). Then update the import at the top to add `ProductCard`:

```tsx
import {
  Badge,
  FulfillmentTags,
  PriceDisplay,
  ProductActions,
  ProductCard,
  SectionHeader,
} from "../../shared/components.js";
```

- [ ] **Step 3: Build to verify no regressions**

```bash
npm run build
```

Expected: exits 0, no TypeScript or Biome errors.

- [ ] **Step 4: Commit**

```bash
git add views/shared/components.tsx views/app/views/ProductSearch.tsx
git commit -m "refactor: extract ProductCard to shared components"
```

---

## Task 2: Pass `app` and `canCallTools` to `RecipeResultsView`

**Files:**

- Modify: `views/App.tsx`

- [ ] **Step 1: Update the `search_recipes_from_web` case in `ShoppingAppInner`**

Find this line in `views/App.tsx`:

```tsx
case "search_recipes_from_web":
  return <RecipeResultsView data={data} />;
```

Replace it with:

```tsx
case "search_recipes_from_web":
  return <RecipeResultsView data={data} app={app} canCallTools={canCallTools} />;
```

- [ ] **Step 2: Skip build here — run it after Task 4**

> `App.tsx` now passes props that `RecipeResultsView` doesn't accept yet. The build will fail until Task 4 updates the component signature. Proceed directly to Task 3.

---

## Task 3: Create `RecipeShoppingView.tsx`

**Files:**

- Create: `views/app/views/RecipeShoppingView.tsx`

- [ ] **Step 1: Create the file with the full implementation**

```tsx
import { useState } from "react";
import type { App } from "@modelcontextprotocol/ext-apps/react";
import { ActionButton, ProductCard } from "../../shared/components.js";
import { Loading } from "../../shared/status.js";
import {
  callTool,
  type ProductData,
  type ProductSearchResultsContent,
  type RecipeData,
} from "../../shared/types.js";

// --- Pantry staple classification ---

const STAPLE_CATEGORIES = new Set([
  "Spices & Seasonings",
  "Baking",
  "Baking Supplies",
  "Condiments & Sauces",
  "Pantry",
  "Oils & Vinegars",
  "Salt & Sugar",
]);

const STAPLE_KEYWORDS = [
  "salt",
  "pepper",
  "oil",
  "butter",
  "flour",
  "sugar",
  "water",
  "baking soda",
  "baking powder",
  "vinegar",
  "vanilla",
];

function isPantryStaple(term: string, firstProduct: ProductData | undefined): boolean {
  if (firstProduct?.categories?.some((c) => STAPLE_CATEGORIES.has(c))) return true;
  const lower = term.toLowerCase();
  return STAPLE_KEYWORDS.some((kw) => lower.includes(kw));
}

// --- Helpers ---

function formatIngredientLabel(ing: {
  quantity?: string;
  unit?: string;
  name: string;
  notes?: string;
}): string {
  return [ing.quantity, ing.unit, ing.name, ing.notes ? `(${ing.notes})` : undefined]
    .filter(Boolean)
    .join(" ");
}

function getProductPrice(product: ProductData): number | null {
  const item = product.items?.[0];
  if (!item?.price?.regular) return null;
  const { regular, promo } = item.price;
  return promo != null && promo !== regular ? promo : regular;
}

// --- Component ---

export function RecipeShoppingView({
  recipe,
  results,
  canCallTools,
  app,
  onBack,
}: {
  recipe: RecipeData;
  results: ProductSearchResultsContent;
  canCallTools: boolean;
  app: App | null;
  onBack: () => void;
}) {
  const [includeStaples, setIncludeStaples] = useState(true);
  const [showStapleDetails, setShowStapleDetails] = useState(false);
  const [addAllState, setAddAllState] = useState<"idle" | "loading" | "done" | "error">("idle");

  const ingredients = recipe.ingredients ?? [];
  const searched = ingredients.slice(0, 10);
  const notSearched = ingredients.slice(10);

  // Map ingredient name → ingredient object for label lookups
  const nameToIngredient = new Map(searched.map((ing) => [ing.name, ing]));

  // Classify each search result
  const classified = results.results.map((result) => {
    const firstProduct = result.failed ? undefined : result.products[0];
    const staple =
      !result.failed && result.products.length > 0 && isPantryStaple(result.term, firstProduct);
    return { result, staple };
  });

  const mainEntries = classified.filter((e) => !e.staple);
  const stapleEntries = classified.filter((e) => e.staple);
  const mainWithResults = mainEntries.filter(
    (e) => !e.result.failed && e.result.products.length > 0,
  ).length;
  const stapleCount = stapleEntries.length;

  // Per-card action handlers (single-item calls, same as ProductSearchView)
  const handleAddToCart = async (upc: string, qty: number) => {
    const r = await callTool(app, {
      name: "add_to_cart",
      arguments: { items: [{ upc, quantity: qty, modality: "PICKUP" }] },
    });
    if (r?.isError) {
      const msg =
        r.content
          ?.map((c) => ("text" in c ? c.text : ""))
          .filter(Boolean)
          .join(" ") || "Failed to add to cart";
      throw new Error(msg);
    }
  };

  const handleAddToList = async (name: string, upc: string) => {
    const r = await callTool(app, {
      name: "manage_shopping_list",
      arguments: { action: "add", items: [{ productName: name, upc, quantity: 1 }] },
    });
    if (r?.isError) {
      const msg =
        r.content
          ?.map((c) => ("text" in c ? c.text : ""))
          .filter(Boolean)
          .join(" ") || "Failed to add to list";
      throw new Error(msg);
    }
  };

  // "Add All to Cart" — single batched call
  const handleAddAll = async () => {
    setAddAllState("loading");
    const items: Array<{ upc: string; quantity: number; modality: string }> = [];
    for (const { result, staple } of classified) {
      if (staple && !includeStaples) continue;
      const upc = result.products[0]?.upc;
      if (upc) items.push({ upc, quantity: 1, modality: "PICKUP" });
    }
    if (items.length === 0) {
      setAddAllState("idle");
      return;
    }
    try {
      const r = await callTool(app, {
        name: "add_to_cart",
        arguments: { items },
      });
      if (r?.isError) throw new Error("Failed to add to cart");
      setAddAllState("done");
      setTimeout(() => setAddAllState("idle"), 2000);
    } catch {
      setAddAllState("error");
      setTimeout(() => setAddAllState("idle"), 3000);
    }
  };

  // Estimated total — sums available prices, skips products with no pricing.
  // `partial` is true when at least one product was skipped, shown as "~$X.XX".
  let total = 0;
  let partial = false;
  let anyPriced = false;
  for (const { result, staple } of classified) {
    if (staple && !includeStaples) continue;
    const product = result.products[0];
    if (!product) continue;
    const price = getProductPrice(product);
    if (price == null) {
      partial = true;
    } else {
      total += price;
      anyPriced = true;
    }
  }

  // Reusable ingredient card renderer
  const renderIngredientCard = (
    result: ProductSearchResultsContent["results"][number],
    idx: number,
  ) => {
    const ing = nameToIngredient.get(result.term);
    const label = ing ? formatIngredientLabel(ing) : result.term;
    const product = result.products[0];

    return (
      <div key={`${result.term}-${idx}`}>
        <p className="text-[10px] text-gray-400 mb-1 truncate" title={label}>
          {label}
        </p>
        {product ? (
          <ProductCard
            product={product}
            canCallTools={canCallTools}
            onAddToCart={handleAddToCart}
            onAddToList={handleAddToList}
          />
        ) : (
          <div className="rounded-lg border border-[var(--app-border)] bg-gray-50 p-4 text-[11px] text-gray-400 text-center">
            No results found
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="px-3.5 py-3 max-w-4xl mx-auto animate-view-in pb-20">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="text-sm font-semibold text-gray-900 tracking-tight leading-snug line-clamp-1">
          Ingredients for {recipe.title}
        </h1>
        <button
          type="button"
          onClick={onBack}
          className="shrink-0 text-[11px] text-[var(--app-accent-text)] hover:opacity-80 transition-opacity flex items-center gap-1 bg-transparent border-0 p-0 cursor-pointer"
        >
          <svg
            aria-hidden="true"
            className="w-3 h-3"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          Show All Recipes
        </button>
      </div>

      {/* Subtitle */}
      <p className="text-[11px] text-gray-400 mb-4">
        {mainWithResults} product{mainWithResults !== 1 ? "s" : ""}
        {stapleCount > 0 && ` | ${stapleCount} pantry staple${stapleCount !== 1 ? "s" : ""}`}
      </p>

      {/* Main ingredient cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
        {mainEntries.map(({ result }, idx) => renderIngredientCard(result, idx))}
      </div>

      {/* Not searched */}
      {notSearched.length > 0 && (
        <div className="mb-4">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
            Not searched
          </p>
          <div className="flex flex-wrap gap-1.5">
            {notSearched.map((ing) => (
              <span
                key={ing.name}
                className="inline-flex text-[11px] text-gray-500 bg-gray-100 rounded-full px-2.5 py-1"
              >
                {formatIngredientLabel(ing)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Pantry staples section */}
      {stapleCount > 0 && (
        <div className="mb-4 rounded-lg border border-[var(--app-border)] p-3">
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeStaples}
                onChange={(e) => setIncludeStaples(e.target.checked)}
                className="rounded border-gray-300 accent-[var(--app-accent)]"
              />
              <span className="text-[12px] text-gray-700">
                Include {stapleCount} pantry staple{stapleCount !== 1 ? "s" : ""}
              </span>
            </label>
            <button
              type="button"
              onClick={() => setShowStapleDetails((v) => !v)}
              className="text-[11px] text-[var(--app-accent-text)] hover:opacity-80 transition-opacity bg-transparent border-0 p-0 cursor-pointer shrink-0"
            >
              {showStapleDetails ? "Hide Details" : "Show Details"}
            </button>
          </div>
          {showStapleDetails && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
              {stapleEntries.map(({ result }, idx) => renderIngredientCard(result, idx))}
            </div>
          )}
        </div>
      )}

      {/* Sticky footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-[var(--app-border)] px-3.5 py-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] text-gray-400">Estimated Recipe Total</p>
          <p className="text-sm font-semibold text-gray-900">
            {anyPriced ? `${partial ? "~" : ""}$${total.toFixed(2)}` : "—"}
          </p>
        </div>
        <ActionButton
          state={addAllState}
          onClick={handleAddAll}
          disabled={!canCallTools}
          idleLabel="Add All to Cart"
          loadingLabel="Adding…"
          doneLabel="Added!"
          failLabel="Failed"
          variant="primary"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build to verify the new file compiles**

```bash
npm run build
```

Expected: exits 0. Fix any TypeScript errors before proceeding.

- [ ] **Step 3: Commit**

```bash
git add views/app/views/RecipeShoppingView.tsx
git commit -m "feat: add RecipeShoppingView with pantry staple classification"
```

---

## Task 4: Update `RecipeResults.tsx` with mode state and Shop Ingredients button

**Files:**

- Modify: `views/app/views/RecipeResults.tsx`

- [ ] **Step 1: Replace the entire file with the updated version**

```tsx
import { useState } from "react";
import type { App } from "@modelcontextprotocol/ext-apps/react";
import { Badge, SectionHeader } from "../../shared/components.js";
import { EmptyState, Loading } from "../../shared/status.js";
import {
  callTool,
  parseStructuredContent,
  type ProductSearchResultsContent,
  type RecipeData,
  type RecipeResultsContent,
} from "../../shared/types.js";
import { RecipeShoppingView } from "./RecipeShoppingView.js";

type RecipeViewMode =
  | { mode: "recipes" }
  | {
      mode: "shopping";
      recipe: RecipeData;
      results: ProductSearchResultsContent | null;
      loading: boolean;
      error: string | null;
    };

function RecipeCard({
  recipe,
  onShopIngredients,
}: {
  recipe: RecipeData;
  onShopIngredients: (recipe: RecipeData) => void;
}) {
  const [showInstructions, setShowInstructions] = useState(false);
  const time = recipe.totalTime ?? recipe.cookTime;

  return (
    <div className="bg-[var(--app-card-bg)] rounded-lg border border-[var(--app-border)] hover:border-[var(--app-border-hover)] hover:shadow-sm transition-all duration-150 overflow-hidden flex flex-col">
      <div className="p-3">
        <h3 className="font-semibold text-[13px] text-gray-900 leading-snug">{recipe.title}</h3>
        {recipe.description && (
          <p className="text-[11px] text-gray-500 mt-1 line-clamp-2 leading-relaxed">
            {recipe.description}
          </p>
        )}

        {/* Meta row */}
        <div className="flex items-center flex-wrap gap-1.5 mt-2">
          {recipe.cuisine && <Badge variant="blue">{recipe.cuisine}</Badge>}
          {recipe.difficulty && (
            <Badge
              variant={
                recipe.difficulty.toLowerCase() === "easy"
                  ? "green"
                  : recipe.difficulty.toLowerCase() === "hard"
                    ? "red"
                    : "gray"
              }
            >
              {recipe.difficulty}
            </Badge>
          )}
          {time && (
            <span className="text-[11px] text-gray-400 flex items-center gap-0.5">
              <svg
                aria-hidden="true"
                className="w-3 h-3"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                />
              </svg>
              {time}min
            </span>
          )}
          {recipe.servings && (
            <span className="text-[11px] text-gray-400">{recipe.servings} servings</span>
          )}
        </div>
      </div>

      {/* Ingredients */}
      {recipe.ingredients && recipe.ingredients.length > 0 && (
        <div className="px-3 pb-3 border-t border-[var(--app-border)]">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mt-2.5 mb-1.5">
            Ingredients · {recipe.ingredients.length}
          </p>
          <div className="text-[11px] text-gray-600 space-y-0.5">
            {recipe.ingredients.slice(0, 6).map((ing) => {
              const amount = [ing.quantity, ing.unit].filter(Boolean).join(" ");
              return (
                <div key={`${ing.name}-${ing.quantity}`} className="flex gap-1.5 items-baseline">
                  <span className="text-gray-300 shrink-0">·</span>
                  <span>
                    {amount && <span className="text-gray-400 mr-0.5">{amount}</span>}
                    <span className="font-medium text-gray-700">{ing.name}</span>
                    {ing.notes && <span className="text-gray-400 ml-0.5">({ing.notes})</span>}
                  </span>
                </div>
              );
            })}
            {recipe.ingredients.length > 6 && (
              <p className="text-gray-400 pl-3">+{recipe.ingredients.length - 6} more</p>
            )}
          </div>
        </div>
      )}

      {/* Instructions toggle */}
      {recipe.instructions && recipe.instructions.length > 0 && (
        <div className="px-3 pb-3 border-t border-[var(--app-border)]">
          <button
            type="button"
            onClick={() => setShowInstructions((v) => !v)}
            className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider hover:text-gray-600 transition-colors select-none mt-2.5 flex items-center gap-1 w-full text-left bg-transparent border-0 p-0 cursor-pointer"
          >
            <svg
              aria-hidden="true"
              className={`w-3 h-3 transition-transform ${showInstructions ? "rotate-90" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2.5}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
            Instructions · {recipe.instructions.length} steps
          </button>
          {showInstructions && (
            <div className="text-[11px] text-gray-600 mt-2 space-y-2">
              {recipe.instructions.map((step) => (
                <div key={step.stepNumber} className="flex gap-2">
                  <span className="shrink-0 w-4 h-4 rounded-sm bg-gray-100 text-gray-500 text-[9px] font-bold flex items-center justify-center">
                    {step.stepNumber}
                  </span>
                  <span className="pt-0.5 leading-relaxed">{step.instruction}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="px-3 py-2.5 mt-auto border-t border-[var(--app-border)] bg-gray-50/50 flex items-center gap-2">
        <a
          href={`https://janella-cookbook.vercel.app/recipe/${recipe.slug}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--app-accent-text)] hover:opacity-80 transition-opacity no-underline"
        >
          View full recipe
          <svg
            aria-hidden="true"
            className="w-2.5 h-2.5"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
            />
          </svg>
        </a>
        {recipe.ingredients && recipe.ingredients.length > 0 && (
          <button
            type="button"
            onClick={() => onShopIngredients(recipe)}
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-[var(--app-accent-text)] px-3 py-1 text-[11px] font-medium text-[var(--app-accent-text)] hover:bg-[var(--app-accent-text)]/5 transition-colors bg-transparent cursor-pointer"
          >
            <svg
              aria-hidden="true"
              className="w-3 h-3"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z"
              />
            </svg>
            Shop Ingredients
          </button>
        )}
      </div>
    </div>
  );
}

export function RecipeResultsView({
  data,
  app,
  canCallTools,
}: {
  data: RecipeResultsContent;
  app: App | null;
  canCallTools: boolean;
}) {
  const [viewMode, setViewMode] = useState<RecipeViewMode>({ mode: "recipes" });

  const handleShopIngredients = async (recipe: RecipeData) => {
    if (!recipe.ingredients?.length) return;
    setViewMode({ mode: "shopping", recipe, results: null, loading: true, error: null });
    const terms = recipe.ingredients.slice(0, 10).map((i) => i.name);
    try {
      const result = await callTool(app, {
        name: "search_products",
        arguments: { terms },
      });
      if (result?.isError) {
        const msg =
          result.content
            ?.map((c) => ("text" in c ? c.text : ""))
            .filter(Boolean)
            .join(" ") || "Search failed. Try again.";
        setViewMode({ mode: "shopping", recipe, results: null, loading: false, error: msg });
        return;
      }
      // `structuredContent` is present on `CallToolResult` in this SDK version —
      // same access pattern used in App.tsx line 127.
      const parsed = parseStructuredContent(result?.structuredContent);
      if (parsed?._view === "search_products") {
        setViewMode({ mode: "shopping", recipe, results: parsed, loading: false, error: null });
      } else {
        setViewMode({
          mode: "shopping",
          recipe,
          results: null,
          loading: false,
          error: "Unexpected response from search. Try again.",
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Search failed. Try again.";
      setViewMode({ mode: "shopping", recipe, results: null, loading: false, error: msg });
    }
  };

  // Shopping mode states
  if (viewMode.mode === "shopping") {
    if (viewMode.loading) {
      return <Loading message="Searching for ingredients…" />;
    }
    if (viewMode.error || !viewMode.results) {
      return (
        <div className="px-3.5 py-3 max-w-4xl mx-auto">
          <button
            type="button"
            onClick={() => setViewMode({ mode: "recipes" })}
            className="text-[11px] text-[var(--app-accent-text)] hover:opacity-80 flex items-center gap-1 mb-4 bg-transparent border-0 p-0 cursor-pointer"
          >
            <svg
              aria-hidden="true"
              className="w-3 h-3"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
            Back to recipes
          </button>
          <p className="text-sm text-red-600 mb-3">{viewMode.error ?? "Something went wrong."}</p>
          <button
            type="button"
            onClick={() => handleShopIngredients(viewMode.recipe)}
            className="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 cursor-pointer bg-transparent"
          >
            Try again
          </button>
        </div>
      );
    }
    return (
      <RecipeShoppingView
        recipe={viewMode.recipe}
        results={viewMode.results}
        canCallTools={canCallTools}
        app={app}
        onBack={() => setViewMode({ mode: "recipes" })}
      />
    );
  }

  // Recipes mode (default)
  const { recipes, searchQuery } = data;

  if (recipes.length === 0) {
    return (
      <div className="px-3.5 py-3 max-w-4xl mx-auto animate-view-in">
        <h1 className="text-sm font-semibold text-gray-900 tracking-tight mb-1">Recipes</h1>
        <EmptyState
          icon={
            <svg
              aria-hidden="true"
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
              />
            </svg>
          }
          message={`No recipes found for "${searchQuery}"`}
          description="Try a different search term."
        />
      </div>
    );
  }

  return (
    <div className="px-3.5 py-3 max-w-4xl mx-auto animate-view-in">
      <SectionHeader
        title="Recipes"
        badge={<span className="text-[11px] text-gray-400 font-mono">{recipes.length} found</span>}
        subtitle={`Results for "${searchQuery}"`}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {recipes.map((recipe) => (
          <RecipeCard key={recipe.slug} recipe={recipe} onShopIngredients={handleShopIngredients} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build to verify everything compiles**

```bash
npm run build
```

Expected: exits 0, no errors. Fix any TypeScript or Biome errors before proceeding.

- [ ] **Step 3: Commit**

```bash
git add views/app/views/RecipeResults.tsx views/App.tsx
git commit -m "feat: add Shop Ingredients button and in-view ingredient shopping"
```

---

## Task 5: Final build verification

- [ ] **Step 1: Run full build**

```bash
npm run build
```

Expected: exits 0, `dist/views/app.html` is generated with no errors.

- [ ] **Step 2: Verify the dev harness renders recipes correctly**

Run the dev harness:

```bash
npm run dev
```

Open the harness URL in a browser and select the `search_recipes_from_web` mock data. Verify:

- Recipe cards render with a "Shop Ingredients" button in the footer (only when ingredients exist)
- The button is styled as a rounded outline with accent color text
- "View full recipe" link still appears

- [ ] **Step 3: Final commit if any polish fixes were made**

```bash
git add -p  # stage only intentional changes
git commit -m "fix: recipe shopping view polish"
```

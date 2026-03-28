import type { App } from "@modelcontextprotocol/ext-apps/react";

import { useEffect, useState } from "react";

import { ActionButton, ProductCard } from "../../shared/components.js";
import {
  type ProductData,
  type ProductSearchResultsContent,
  type RecipeData,
  callTool,
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

// --- IngredientCard ---

function IngredientCard({
  result,
  ing,
  canCallTools,
  onAddToCart,
  onAddToList,
  onAdded,
}: {
  result: ProductSearchResultsContent["results"][number];
  ing: { quantity?: string; unit?: string; name: string; notes?: string } | undefined;
  canCallTools: boolean;
  onAddToCart: (upc: string, qty: number) => Promise<void>;
  onAddToList: (name: string, upc: string) => Promise<void>;
  onAdded?: (info: { ingredient: string; product: string }) => void;
}) {
  const label = ing ? formatIngredientLabel(ing) : result.term;
  const product = result.products[0];

  const handleAddToCart = async (upc: string, qty: number) => {
    await onAddToCart(upc, qty);
    if (product) {
      onAdded?.({ ingredient: label, product: product.description });
    }
  };

  return (
    <div>
      <p className="text-[10px] text-gray-400 mb-1 truncate" title={label}>
        {label}
      </p>
      {product ? (
        <ProductCard
          product={product}
          canCallTools={canCallTools}
          onAddToCart={handleAddToCart}
          onAddToList={onAddToList}
        />
      ) : (
        <div className="rounded-lg border border-[var(--app-border)] bg-gray-50 p-4 text-[11px] text-gray-400 text-center">
          No results found
        </div>
      )}
    </div>
  );
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

  // LLM context update — individual ingredient added to cart
  const handleIngredientAdded = ({
    ingredient,
    product,
  }: {
    ingredient: string;
    product: string;
  }) => {
    app?.updateModelContext({
      structuredContent: {
        event: "ingredient_added_to_cart",
        recipe: recipe.title,
        ingredient,
        product,
      },
    });
  };

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
      const addedNames = items
        .map(
          (item) =>
            classified.find((e) => e.result.products[0]?.upc === item.upc)?.result.products[0]
              ?.description,
        )
        .filter(Boolean) as string[];
      const nameList =
        addedNames.length <= 3
          ? addedNames.join(", ")
          : `${addedNames.slice(0, 3).join(", ")}, and ${addedNames.length - 3} more`;
      app?.sendMessage({
        role: "user",
        content: [
          {
            type: "text",
            text: `I just added ${addedNames.length} ingredients for ${recipe.title} to my Kroger cart: ${nameList}.`,
          },
        ],
      });
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

  // Mount effect — notify LLM that shopping view opened
  useEffect(() => {
    app?.updateModelContext({
      structuredContent: {
        event: "recipe_shopping_started",
        recipe: recipe.title,
        ingredientCount: ingredients.length,
        stapleCount,
        ...(anyPriced ? { estimatedTotal: parseFloat(total.toFixed(2)) } : {}),
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

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
        {mainEntries.map(({ result }) => (
          <IngredientCard
            key={result.term}
            result={result}
            ing={nameToIngredient.get(result.term)}
            canCallTools={canCallTools}
            onAddToCart={handleAddToCart}
            onAddToList={handleAddToList}
            onAdded={handleIngredientAdded}
          />
        ))}
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
                onChange={(e) => {
                  const next = e.target.checked;
                  setIncludeStaples(next);
                  app?.updateModelContext({
                    structuredContent: {
                      event: "pantry_staples_toggled",
                      recipe: recipe.title,
                      includeStaples: next,
                    },
                  });
                }}
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
              {stapleEntries.map(({ result }) => (
                <IngredientCard
                  key={result.term}
                  result={result}
                  ing={nameToIngredient.get(result.term)}
                  canCallTools={canCallTools}
                  onAddToCart={handleAddToCart}
                  onAddToList={handleAddToList}
                  onAdded={handleIngredientAdded}
                />
              ))}
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

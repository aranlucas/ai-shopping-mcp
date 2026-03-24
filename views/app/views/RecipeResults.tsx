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
      // `structuredContent` is present on CallToolResult in this SDK — same access as App.tsx line 127
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
            disabled={viewMode.loading}
            className="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 cursor-pointer bg-transparent disabled:opacity-40 disabled:cursor-not-allowed"
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

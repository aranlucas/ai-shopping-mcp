import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge } from "../shared/components.js";
import type { RecipeData, RecipeResultsContent } from "../shared/types.js";

function RecipeCard({ recipe }: { recipe: RecipeData }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm hover:shadow-md hover:border-gray-300/80 transition-all duration-200 overflow-hidden">
      <div className="p-4">
        <h3 className="font-bold text-base text-gray-900 leading-snug">
          {recipe.title}
        </h3>
        {recipe.description && (
          <p className="text-xs text-gray-500 mt-1 line-clamp-2">
            {recipe.description}
          </p>
        )}

        <div className="flex items-center flex-wrap gap-1.5 mt-2.5">
          {recipe.cuisine && <Badge variant="blue">{recipe.cuisine}</Badge>}
          {recipe.difficulty && (
            <Badge variant="gray">{recipe.difficulty}</Badge>
          )}
          {recipe.totalTime ? (
            <span className="text-xs text-gray-500 flex items-center gap-1">
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
              {recipe.totalTime}min
            </span>
          ) : recipe.cookTime ? (
            <span className="text-xs text-gray-500 flex items-center gap-1">
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
              {recipe.cookTime}min cook
            </span>
          ) : null}
          {recipe.servings && (
            <span className="text-xs text-gray-500 flex items-center gap-1">
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
                  d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
                />
              </svg>
              {recipe.servings}
            </span>
          )}
        </div>
      </div>

      {recipe.ingredients && recipe.ingredients.length > 0 && (
        <div className="px-4 pb-3">
          <div className="border-t border-gray-100 pt-3">
            <h4 className="text-xs font-semibold text-gray-500 mb-2">
              Ingredients ({recipe.ingredients.length})
            </h4>
            <div className="text-xs text-gray-600 space-y-0.5">
              {recipe.ingredients.map((ing) => {
                const amount = [ing.quantity, ing.unit]
                  .filter(Boolean)
                  .join(" ");
                const notes = ing.notes ? ` (${ing.notes})` : "";
                return (
                  <div key={`${ing.name}-${ing.quantity}`}>
                    <span className="text-gray-400 mr-1">&bull;</span>
                    {amount ? `${amount} ` : ""}
                    <span className="font-medium">{ing.name}</span>
                    {notes && <span className="text-gray-400">{notes}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {recipe.instructions && recipe.instructions.length > 0 && (
        <div className="px-4 pb-3">
          <div className="border-t border-gray-100 pt-3">
            <details>
              <summary className="text-xs font-semibold text-gray-500 cursor-pointer hover:text-gray-700 transition-colors select-none">
                Instructions ({recipe.instructions.length} steps)
              </summary>
              <div className="text-xs text-gray-600 mt-2 space-y-2">
                {recipe.instructions.map((step) => (
                  <div key={step.stepNumber} className="flex gap-2">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-bold flex items-center justify-center">
                      {step.stepNumber}
                    </span>
                    <span className="pt-0.5 leading-relaxed">
                      {step.instruction}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          </div>
        </div>
      )}

      <div className="px-4 pb-4">
        <a
          href={`https://janella-cookbook.vercel.app/recipe/${recipe.slug}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg bg-gray-50 px-3.5 py-2 text-xs font-semibold text-gray-700 ring-1 ring-gray-200 hover:bg-gray-100 active:bg-gray-200 transition-colors no-underline"
        >
          <svg
            aria-hidden="true"
            className="w-3.5 h-3.5"
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
          View Recipe
        </a>
      </div>
    </div>
  );
}

function RecipeResultsView() {
  const [data, setData] = useState<RecipeResultsContent | null>(null);

  const { isConnected, error } = useApp({
    appInfo: { name: "recipe-results", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (appInstance) => {
      appInstance.ontoolresult = (result) => {
        const content = result.structuredContent as
          | RecipeResultsContent
          | undefined;
        if (content?.recipes) {
          setData(content);
        }
      };
      appInstance.onerror = console.error;
    },
  });

  if (error) {
    return (
      <div className="text-center py-12 text-gray-400">
        Error: {error.message}
      </div>
    );
  }
  if (!isConnected || !data) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400 gap-2">
        <svg
          aria-hidden="true"
          className="animate-spin h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        Loading...
      </div>
    );
  }

  const { recipes, searchQuery } = data;

  if (recipes.length === 0) {
    return (
      <div className="p-4 max-w-4xl mx-auto">
        <h1 className="text-xl font-bold text-gray-900 mb-6">Recipe Search</h1>
        <div className="text-center py-16 text-gray-400">
          <svg
            aria-hidden="true"
            className="w-12 h-12 mx-auto mb-3 text-gray-300"
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
          <p className="text-sm">
            No recipes found for &ldquo;{searchQuery}&rdquo;
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <h1 className="text-xl font-bold text-gray-900">
          Recipes for &ldquo;{searchQuery}&rdquo;
        </h1>
        <Badge variant="blue">{recipes.length} found</Badge>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {recipes.map((recipe) => (
          <RecipeCard key={recipe.slug} recipe={recipe} />
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <RecipeResultsView />,
);

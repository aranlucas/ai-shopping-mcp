import { Badge, SectionHeader } from "../../shared/components.js";
import { EmptyState } from "../../shared/status.js";
import type { RecipeData, RecipeResultsContent } from "../../shared/types.js";

function RecipeCard({ recipe }: { recipe: RecipeData }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200/60 shadow-sm hover:shadow-md hover:border-gray-300/80 transition-all duration-200 overflow-hidden flex flex-col">
      <div className="p-3.5">
        <h3 className="font-bold text-sm text-gray-900 leading-snug">{recipe.title}</h3>
        {recipe.description && (
          <p className="text-xs text-gray-500 mt-1 line-clamp-2 leading-relaxed">
            {recipe.description}
          </p>
        )}
        <div className="flex items-center flex-wrap gap-1.5 mt-2.5">
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
          {(recipe.totalTime ?? recipe.cookTime) && (
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
              {recipe.totalTime ?? recipe.cookTime}min
            </span>
          )}
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
        <div className="px-3.5 pb-3 border-t border-gray-100">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mt-2.5 mb-2">
            Ingredients ({recipe.ingredients.length})
          </p>
          <div className="text-xs text-gray-600 space-y-0.5">
            {recipe.ingredients.slice(0, 6).map((ing) => {
              const amount = [ing.quantity, ing.unit].filter(Boolean).join(" ");
              return (
                <div key={`${ing.name}-${ing.quantity}`} className="flex gap-1.5 items-baseline">
                  <span className="text-gray-300 shrink-0">&bull;</span>
                  <span>
                    {amount && <span className="text-gray-400 mr-0.5">{amount}</span>}
                    <span className="font-medium">{ing.name}</span>
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
      {recipe.instructions && recipe.instructions.length > 0 && (
        <div className="px-3.5 pb-3 border-t border-gray-100">
          <details>
            <summary className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-600 transition-colors select-none mt-2.5 mb-0">
              Instructions ({recipe.instructions.length} steps)
            </summary>
            <div className="text-xs text-gray-600 mt-2 space-y-2">
              {recipe.instructions.map((step) => (
                <div key={step.stepNumber} className="flex gap-2">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-bold flex items-center justify-center">
                    {step.stepNumber}
                  </span>
                  <span className="pt-0.5 leading-relaxed">{step.instruction}</span>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
      <div className="px-3.5 py-3 mt-auto border-t border-gray-100">
        <a
          href={`https://janella-cookbook.vercel.app/recipe/${recipe.slug}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors no-underline"
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
              d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
            />
          </svg>
          View full recipe
        </a>
      </div>
    </div>
  );
}

export function RecipeResultsView({ data }: { data: RecipeResultsContent }) {
  const { recipes, searchQuery } = data;

  if (recipes.length === 0) {
    return (
      <div className="p-4 max-w-4xl mx-auto">
        <h1 className="text-lg font-bold text-gray-900 tracking-tight mb-1">Recipe Search</h1>
        <EmptyState
          icon={
            <svg
              aria-hidden="true"
              className="w-6 h-6"
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
    <div className="p-4 max-w-4xl mx-auto">
      <SectionHeader
        title="Recipes"
        badge={<Badge variant="blue">{recipes.length} found</Badge>}
        subtitle={`Results for \u201c${searchQuery}\u201d`}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {recipes.map((recipe) => (
          <RecipeCard key={recipe.slug} recipe={recipe} />
        ))}
      </div>
    </div>
  );
}

import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge } from "../shared/components.js";
import type { RecipeData, RecipeResultsContent } from "../shared/types.js";

function RecipeCard({ recipe }: { recipe: RecipeData }) {
  return (
    <div className="card">
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
        {recipe.title}
      </div>
      {recipe.description && (
        <div className="meta-item">{recipe.description}</div>
      )}

      <div className="meta-row" style={{ marginTop: 6 }}>
        {recipe.cuisine && <Badge variant="blue">{recipe.cuisine}</Badge>}
        {recipe.difficulty && <Badge variant="gray">{recipe.difficulty}</Badge>}
        {recipe.totalTime ? (
          <span className="meta-item">{recipe.totalTime}min</span>
        ) : recipe.cookTime ? (
          <span className="meta-item">{recipe.cookTime}min cook</span>
        ) : null}
        {recipe.servings && (
          <span className="meta-item">{recipe.servings}</span>
        )}
      </div>

      {recipe.ingredients && recipe.ingredients.length > 0 && (
        <>
          <div className="divider" />
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
            Ingredients ({recipe.ingredients.length})
          </div>
          <div style={{ fontSize: 12, color: "#4b5563" }}>
            {recipe.ingredients.map((ing) => {
              const amount = [ing.quantity, ing.unit].filter(Boolean).join(" ");
              const notes = ing.notes ? ` (${ing.notes})` : "";
              return (
                <div
                  key={`${ing.name}-${ing.quantity}`}
                  style={{ margin: "2px 0" }}
                >
                  &bull; {amount ? `${amount} ` : ""}
                  {ing.name}
                  {notes}
                </div>
              );
            })}
          </div>
        </>
      )}

      {recipe.instructions && recipe.instructions.length > 0 && (
        <>
          <div className="divider" />
          <details>
            <summary
              style={{
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                marginBottom: 4,
              }}
            >
              Instructions ({recipe.instructions.length} steps)
            </summary>
            <div style={{ fontSize: 12, color: "#4b5563", marginTop: 4 }}>
              {recipe.instructions.map((step) => (
                <div key={step.stepNumber} style={{ margin: "4px 0" }}>
                  <strong>{step.stepNumber}.</strong> {step.instruction}
                </div>
              ))}
            </div>
          </details>
        </>
      )}

      <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
        <a
          href={`https://janella-cookbook.vercel.app/recipe/${recipe.slug}`}
          target="_blank"
          rel="noreferrer"
          className="btn btn-secondary"
          style={{ textDecoration: "none" }}
        >
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
    return <div className="empty-state">Error: {error.message}</div>;
  }
  if (!isConnected || !data) {
    return <div id="loading">Loading...</div>;
  }

  const { recipes, searchQuery } = data;

  if (recipes.length === 0) {
    return (
      <>
        <div className="header">Recipe Search</div>
        <div className="empty-state">
          No recipes found for &ldquo;{searchQuery}&rdquo;
        </div>
      </>
    );
  }

  return (
    <>
      <div className="header">
        Recipes for &ldquo;{searchQuery}&rdquo;{" "}
        <Badge variant="blue">{recipes.length} found</Badge>
      </div>
      <div className="grid grid-2">
        {recipes.map((recipe) => (
          <RecipeCard key={recipe.slug} recipe={recipe} />
        ))}
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<RecipeResultsView />);

import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { err, ok, ResultAsync, safeTry } from "neverthrow";
import { z } from "zod";
import type { AppError } from "../errors.js";
import { networkError } from "../errors.js";
import {
  requireAuth,
  safeFetch,
  safeStorage,
  toMcpError,
  toMcpResponse,
} from "../utils/result.js";
import { registerViewResource } from "../utils/view-resource.js";
import { type ToolContext, textResult } from "./types.js";

export function registerRecipeTools(ctx: ToolContext) {
  const recipeResultsUri = "ui://recipe-results";
  registerViewResource(ctx, recipeResultsUri, "recipe-results/index.html");

  registerAppTool(
    ctx.server,
    "search_recipes_from_web",
    {
      title: "Search Recipes",
      description:
        "Searches for recipes from Janella's Cookbook API. Returns detailed recipe information including ingredients, instructions, and metadata.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: { ui: { resourceUri: recipeResultsUri } },
      inputSchema: z.object({
        searchQuery: z
          .string()
          .min(1)
          .max(200)
          .describe("Recipe search query (e.g., 'Cookie', 'Pasta', 'Chicken')"),
      }),
    },
    async ({ searchQuery }) => {
      const apiUrl = "https://janella-cookbook.vercel.app/api/search";

      const result = safeFetch(
        apiUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: searchQuery }),
          signal: AbortSignal.timeout(15_000),
        },
        "Recipe API request",
      )
        .andThen((response) =>
          ResultAsync.fromPromise(
            response.json() as Promise<{
              success: boolean;
              data?: {
                results: Array<{
                  recipe: {
                    title: string;
                    description?: string;
                    prepTime?: number;
                    cookTime?: number;
                    totalTime?: number;
                    servings?: string;
                    difficulty?: string;
                    cuisine?: string;
                    slug: string;
                    ingredients?: Array<{
                      quantity?: string;
                      unit?: string;
                      name: string;
                      notes?: string;
                    }>;
                    instructions?: Array<{
                      stepNumber: number;
                      instruction: string;
                    }>;
                  };
                }>;
              };
              error?: { message: string };
            }>,
            (e) =>
              networkError(
                `Failed to parse recipe response: ${e instanceof Error ? e.message : String(e)}`,
                e,
              ),
          ),
        )
        .andThen((apiResponse) => {
          if (!apiResponse.success || !apiResponse.data?.results) {
            return err(
              networkError(
                `Recipe search failed: ${apiResponse.error?.message || "No results returned from API"}`,
              ),
            );
          }

          const recipes = apiResponse.data.results;

          if (recipes.length === 0) {
            return ok({
              text: `No recipes found for "${searchQuery}". Try a different search term.`,
              recipes: [] as typeof recipes,
            });
          }

          const formattedRecipes = recipes
            .map((result, idx) => {
              const recipe = result.recipe;
              const parts = [`**${idx + 1}. ${recipe.title}**`];

              if (recipe.description) {
                parts.push(recipe.description);
              }

              const metadata = [];
              if (recipe.cuisine) metadata.push(recipe.cuisine);
              if (recipe.difficulty)
                metadata.push(recipe.difficulty.toLowerCase());
              if (recipe.totalTime)
                metadata.push(`${recipe.totalTime}min total`);
              else if (recipe.cookTime)
                metadata.push(`${recipe.cookTime}min cook`);
              if (recipe.servings) metadata.push(recipe.servings);
              if (metadata.length > 0) {
                parts.push(`*${metadata.join(" • ")}*`);
              }

              if (recipe.ingredients && recipe.ingredients.length > 0) {
                parts.push("\n**Ingredients:**");
                for (const ing of recipe.ingredients) {
                  const amount = [ing.quantity, ing.unit]
                    .filter(Boolean)
                    .join(" ");
                  const notes = ing.notes ? ` (${ing.notes})` : "";
                  parts.push(`- ${amount} ${ing.name}${notes}`.trim());
                }
              }

              if (recipe.instructions && recipe.instructions.length > 0) {
                parts.push("\n**Instructions:**");
                for (const step of recipe.instructions) {
                  parts.push(`${step.stepNumber}. ${step.instruction}`);
                }
              }

              parts.push(
                `\n*View online: https://janella-cookbook.vercel.app/recipe/${recipe.slug}*`,
              );

              return parts.join("\n");
            })
            .join("\n\n---\n\n");

          return ok({
            text: `**Recipe Search Results for "${searchQuery}"**\n\nFound ${recipes.length} recipe(s):\n\n${formattedRecipes}`,
            recipes,
          });
        });

      const res = await result;
      if (res.isErr()) {
        return toMcpResponse(res.map(() => ""));
      }

      const { text, recipes: recipeData } = res.value;
      if (recipeData.length === 0) {
        return textResult(text);
      }

      return {
        content: [{ type: "text" as const, text }],
        structuredContent: {
          recipes: recipeData.map((r) => r.recipe),
          searchQuery,
        },
      };
    },
  );

  ctx.server.registerTool(
    "plan_meals",
    {
      title: "Plan Meals from Pantry",
      description:
        "AI-powered meal suggestions based on pantry inventory, kitchen equipment, and shopping history. Prioritizes ingredients expiring soon to reduce food waste.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: z.object({
        numberOfMeals: z
          .number()
          .min(1)
          .max(7)
          .optional()
          .default(3)
          .describe("Number of meal suggestions to generate (1-7)"),
        mealType: z
          .enum(["any", "breakfast", "lunch", "dinner", "snack"])
          .optional()
          .default("any")
          .describe("Type of meals to suggest"),
        dietaryPreferences: z
          .string()
          .max(300)
          .optional()
          .describe(
            "Dietary preferences or restrictions (e.g., 'vegetarian', 'low-carb', 'gluten-free')",
          ),
        prioritizeExpiring: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            "Whether to prioritize using ingredients that are expiring soon",
          ),
      }),
    },
    async ({
      numberOfMeals,
      mealType,
      dietaryPreferences,
      prioritizeExpiring,
    }) => {
      const { storage } = ctx;

      // Fetch user data in parallel using safeTry + ResultAsync.combine (auth folded in)
      const dataResult = await safeTry(async function* () {
        const props = yield* requireAuth(ctx.getUser).safeUnwrap();

        const [pantry, equipment, recentOrders] = yield* ResultAsync.combine([
          safeStorage(() => storage.pantry.getAll(props.id), "fetch pantry"),
          safeStorage(
            () => storage.equipment.getAll(props.id),
            "fetch equipment",
          ),
          safeStorage(
            () => storage.orderHistory.getRecent(props.id, 10),
            "fetch order history",
          ),
        ]).safeUnwrap();

        return ok({ pantry, equipment, recentOrders });
      });

      if (dataResult.isErr()) return toMcpError(dataResult.error);

      const { pantry, equipment, recentOrders } = dataResult.value;

      if (pantry.length === 0) {
        return textResult(
          "Your pantry is empty. Add items to your pantry first using manage_pantry with action 'add', then try planning meals again.",
        );
      }

      // Categorize pantry items by expiry urgency
      const now = Date.now();
      const categorizedPantry = pantry.map((item) => {
        if (!item.expiresAt)
          return { ...item, urgency: "none" as const, daysUntil: undefined };
        const expiresAtMs = new Date(item.expiresAt).getTime();
        if (Number.isNaN(expiresAtMs))
          return { ...item, urgency: "none" as const, daysUntil: undefined };
        const daysUntil = Math.floor(
          (expiresAtMs - now) / (1000 * 60 * 60 * 24),
        );
        if (daysUntil < 0)
          return { ...item, urgency: "expired" as const, daysUntil };
        if (daysUntil <= 1)
          return { ...item, urgency: "critical" as const, daysUntil };
        if (daysUntil <= 3)
          return { ...item, urgency: "warning" as const, daysUntil };
        return { ...item, urgency: "ok" as const, daysUntil };
      });

      const expiringItems = categorizedPantry.filter(
        (item) => item.urgency === "critical" || item.urgency === "warning",
      );
      const expiredItems = categorizedPantry.filter(
        (item) => item.urgency === "expired",
      );
      const availableItems = categorizedPantry.filter(
        (item) => item.urgency !== "expired",
      );

      // Build the meal planning prompt
      const promptParts: string[] = [];
      promptParts.push(
        `Generate ${numberOfMeals} practical meal suggestion(s)${mealType !== "any" ? ` for ${mealType}` : ""}. Focus on meals that can be made primarily with the available pantry items.`,
      );

      if (dietaryPreferences) {
        promptParts.push(`\nDietary preferences: ${dietaryPreferences}`);
      }

      if (prioritizeExpiring && expiringItems.length > 0) {
        promptParts.push("\nPRIORITY - Use these expiring ingredients first:");
        for (const item of expiringItems) {
          const urgencyLabel =
            item.urgency === "critical"
              ? "EXPIRES TODAY/TOMORROW"
              : "expires in 2-3 days";
          promptParts.push(
            `  - ${item.productName} (x${item.quantity}) - ${urgencyLabel}`,
          );
        }
      }

      promptParts.push(`\nAvailable pantry items (${availableItems.length}):`);
      for (const item of availableItems) {
        promptParts.push(`  - ${item.productName} (x${item.quantity})`);
      }

      if (equipment.length > 0) {
        promptParts.push(
          `\nAvailable kitchen equipment (${equipment.length}):`,
        );
        for (const item of equipment) {
          promptParts.push(
            `  - ${item.equipmentName}${item.category ? ` (${item.category})` : ""}`,
          );
        }
      }

      // Extract frequently ordered items for preference insight
      const frequentItems: Array<[string, number]> = [];
      if (recentOrders.length > 0) {
        const itemFrequency = new Map<string, number>();
        for (const order of recentOrders) {
          for (const item of order.items) {
            const name = item.productName.toLowerCase();
            itemFrequency.set(name, (itemFrequency.get(name) || 0) + 1);
          }
        }
        frequentItems.push(
          ...[...itemFrequency.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10),
        );
      }

      if (frequentItems.length > 0) {
        promptParts.push("\nFrequently purchased items (user preferences):");
        for (const [name, count] of frequentItems) {
          promptParts.push(`  - ${name} (ordered ${count}x)`);
        }
      }

      promptParts.push(
        "\nFor each meal, provide:",
        "1. Meal name",
        "2. Brief description",
        "3. Ingredients from pantry (mark which are expiring soon)",
        "4. Additional ingredients needed (not in pantry)",
        "5. Quick cooking steps",
        "6. Estimated prep/cook time",
      );

      const prompt = promptParts.join("\n");

      // Build response header with expiry context
      const headerParts: string[] = [];
      headerParts.push(
        `**Meal Plan** (${numberOfMeals} meal${numberOfMeals > 1 ? "s" : ""}${mealType !== "any" ? ` - ${mealType}` : ""})`,
      );
      if (expiringItems.length > 0) {
        headerParts.push(
          `\n⚠️ ${expiringItems.length} item(s) expiring soon - prioritized in suggestions`,
        );
      }
      if (expiredItems.length > 0) {
        headerParts.push(
          `\n❌ ${expiredItems.length} expired item(s) excluded: ${expiredItems.map((i) => i.productName).join(", ")}`,
        );
      }

      // Try MCP sampling for AI-powered meal suggestions
      const samplingResult = await ResultAsync.fromPromise(
        ctx.keepAliveWhile(() =>
          ctx.server.server.createMessage({
            messages: [
              {
                role: "user",
                content: { type: "text", text: prompt },
              },
            ],
            maxTokens: 2000,
          }),
        ),
        (e): AppError =>
          networkError(
            `MCP sampling failed: ${e instanceof Error ? e.message : String(e)}`,
            e,
          ),
      ).orTee((error) =>
        console.error("MCP sampling failed for meal planning:", error.message),
      );

      if (samplingResult.isOk()) {
        const contentItem = Array.isArray(samplingResult.value.content)
          ? samplingResult.value.content[0]
          : samplingResult.value.content;
        const responseText =
          contentItem && "type" in contentItem && contentItem.type === "text"
            ? contentItem.text
            : "Unable to process meal plan response.";

        return textResult(`${headerParts.join("")}\n\n${responseText}`);
      }

      // Fallback: return structured context so the outer AI can generate suggestions

      const fallbackParts: string[] = [];
      fallbackParts.push(headerParts.join(""));

      if (dietaryPreferences) {
        fallbackParts.push(`\nDietary preferences: ${dietaryPreferences}`);
      }

      if (expiringItems.length > 0) {
        fallbackParts.push("\n**⚠️ Expiring Soon (use first!):**");
        for (const item of expiringItems) {
          const urgency =
            item.urgency === "critical" ? "TODAY/TOMORROW" : "2-3 days";
          fallbackParts.push(
            `- ${item.productName} x${item.quantity} (${urgency})`,
          );
        }
      }

      if (expiredItems.length > 0) {
        fallbackParts.push("\n**❌ Expired (discard):**");
        for (const item of expiredItems) {
          fallbackParts.push(`- ${item.productName}`);
        }
      }

      fallbackParts.push(`\n**Pantry (${availableItems.length} items):**`);
      for (const item of availableItems) {
        fallbackParts.push(`- ${item.productName} x${item.quantity}`);
      }

      if (equipment.length > 0) {
        fallbackParts.push(`\n**Equipment (${equipment.length} items):**`);
        for (const item of equipment) {
          fallbackParts.push(
            `- ${item.equipmentName}${item.category ? ` (${item.category})` : ""}`,
          );
        }
      }

      if (frequentItems.length > 0) {
        fallbackParts.push("\n**Frequently Purchased (user preferences):**");
        for (const [name, count] of frequentItems) {
          fallbackParts.push(`- ${name} (ordered ${count}x)`);
        }
      }

      fallbackParts.push(
        `\n---\n**Action Required:** Please suggest ${numberOfMeals} meal(s)${mealType !== "any" ? ` for ${mealType}` : ""} using the pantry items above.`,
        "For each meal, include: name, description, pantry ingredients used (flag expiring ones), additional ingredients to buy, cooking steps, and estimated time.",
        "Prioritize using expiring items first to reduce food waste.",
        "After suggesting meals, offer to add any missing ingredients to the shopping list using manage_shopping_list with action 'add'.",
      );

      return textResult(fallbackParts.join("\n"));
    },
  );
}

import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { appResult } from "../app-results.js";
import {
  aggregateMealPlan,
  mealSchema,
  mealPlanChangeSchema,
  MealPlanValidationError,
  type MealPlan,
} from "../domain/meal-plan.js";
import { AppErrorException, storageError, validationError } from "../errors.js";
import type { MealPlanStore } from "../utils/d1-meal-plan-storage.js";
import { getProps, toMcpError } from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { storeIdSchema } from "./schemas.js";

const planIdSchema = z.string().trim().min(1).max(200);

const expectedVersionSchema = z
  .number()
  .int()
  .positive()
  .describe("Version from the last get/update result; reload after a conflict.");

export const createMealPlanInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  storeId: storeIdSchema.describe(
    "Explicit store for product review, usually the saved preferred store.",
  ),
  modality: z.enum(["PICKUP", "DELIVERY"]).default("PICKUP"),
  meals: z
    .array(mealSchema.omit({ id: true }))
    .min(1)
    .max(7)
    .describe(
      "Recipe quantities are for baseServings, scaled to servings. Keep explicit ingredient units; do not infer units from pantry inventory.",
    ),
});

export const getMealPlanInputSchema = z.object({ planId: planIdSchema.optional() });

export const updateMealPlanInputSchema = z.object({
  planId: planIdSchema,
  expectedVersion: expectedVersionSchema,
  change: mealPlanChangeSchema,
});

export const prepareMealPlanInputSchema = z.object({
  planId: planIdSchema,
  expectedVersion: expectedVersionSchema,
});

function planText(plan: MealPlan): string {
  const summary = aggregateMealPlan(plan);

  const meals = plan.meals
    .map((meal) => `${meal.name}: ${meal.servings} servings (mealId=${meal.id})`)
    .join("\n");

  const ingredients = summary.ingredients
    .map(
      (item) =>
        `${item.name}: ${item.requiredQuantity} ${item.unit}; pantry ${item.pantryQuantity}; remaining ${item.remainingQuantity}; ${item.state}; key=${item.key}`,
    )
    .join("\n");

  const next =
    plan.status === "prepared"
      ? plan.shoppingListId
        ? `Shopping list: ${plan.shoppingListId}. Open it with get_shopping_list. Cart addition requires a separate explicit user request; retain store ${plan.storeId} and ${plan.modality}.`
        : "No purchases needed. No shopping list or cart mutation was created."
      : `${summary.unresolvedCount} ingredient(s) need review. Each buy choice needs an explicitly selected UPC and package count; pantry quantities use the recipe unit. After review and user approval, prepare_meal_plan creates one saved list. It does not add to a cart.`;

  return `Meal plan "${plan.name}" (planId=${plan.id}, version=${plan.version}, ${plan.status})\nStore ${plan.storeId}, ${plan.modality}\n${meals}\n\n${ingredients}\n\n${next}`;
}

function planResult(plan: MealPlan) {
  return {
    content: [{ type: "text" as const, text: planText(plan) }],
    ...appResult("meal_plan", { plan }),
  };
}

/** Keep domain/conflict errors actionable and never expose database exceptions. */
async function runPlanOperation(operation: () => Promise<MealPlan>) {
  getProps();

  try {
    return planResult(await operation());
  } catch (error) {
    if (error instanceof AppErrorException) {
      return toMcpError(error.appError);
    }

    if (error instanceof MealPlanValidationError) {
      return toMcpError(validationError(error.message));
    }

    return toMcpError(
      storageError(
        "Could not load or save the meal plan. Use get_meal_plan to check its saved state before retrying.",
      ),
    );
  }
}

/** Resumable meal planning uses the existing shopper identity and shopping-list checkout. */
export function registerMealPlanTools(server: McpServer, plans: MealPlanStore): void {
  const ui = { ui: { resourceUri: APP_VIEW_URI } };

  const annotations = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  };

  registerAppTool(
    server,
    "create_meal_plan",
    {
      title: "Save Meal Plan",
      description:
        "Save 1–7 chosen meals, servings and ingredient quantities for later review. Call get_shopping_profile first. Plan IDs and meal IDs are returned. No inventory or cart is changed. After an ambiguous create response, use get_meal_plan with no arguments to find the saved plan instead of creating a duplicate.",
      inputSchema: createMealPlanInputSchema,
      _meta: ui,
      annotations,
    },
    (input) =>
      runPlanOperation(() =>
        plans.create({
          ...input,
          meals: input.meals.map((meal) => ({
            ...meal,
            id: `meal_${crypto.randomUUID().replaceAll("-", "")}`,
          })),
          decisions: [],
        }),
      ),
  );

  registerAppTool(
    server,
    "get_meal_plan",
    {
      title: "Resume Meal Plan",
      description:
        "With planId, resume saved meals, servings and ingredient decisions. Without it, show the 50 most recently updated plans. Read the returned version before changing or preparing a plan.",
      inputSchema: getMealPlanInputSchema,
      _meta: ui,
      annotations: { ...annotations, readOnlyHint: true, idempotentHint: true },
    },
    async ({ planId }) => {
      if (planId) {
        return runPlanOperation(() => plans.get(planId));
      }

      getProps();

      try {
        const saved = await plans.list();

        return {
          content: [
            {
              type: "text" as const,
              text: saved.length
                ? saved
                    .map(
                      (plan) =>
                        `planId=${plan.id} "${plan.name}" (${plan.mealCount} meals, ${plan.status})`,
                    )
                    .join("\n")
                : "No saved meal plans. Choose meals, then create_meal_plan.",
            },
          ],
          ...appResult("meal_plans", { plans: saved }),
        };
      } catch {
        return toMcpError(storageError("Could not load meal plans. Retry get_meal_plan."));
      }
    },
  );

  registerAppTool(
    server,
    "update_meal_plan",
    {
      title: "Review or Adjust Meal Plan",
      description:
        "Edit a draft using its current version and meal IDs (new unique ID for add_meal). Review ingredient keys from get_meal_plan: confirm pantryQuantity in recipe units; buy needs a search_products selection and explicit packages; pantry must cover all; exclude needs a reason. Never infer units or package conversions. Changed totals/stores need review again. Prepared plans are immutable.",
      inputSchema: updateMealPlanInputSchema,
      _meta: ui,
      annotations,
    },
    ({ planId, expectedVersion, change }) =>
      runPlanOperation(() => plans.update(planId, expectedVersion, change)),
  );

  registerAppTool(
    server,
    "prepare_meal_plan",
    {
      title: "Prepare Reviewed Shopping List",
      description:
        "After user approval, prepare one shopping list; unresolved/stale decisions are rejected. Retries return the same list, even with the old version. Pantry-only plans need no list. No Kroger or cart call occurs. Use get_shopping_list then a separately approved add_shopping_list_to_cart, retaining the reviewed store/modality.",
      inputSchema: prepareMealPlanInputSchema,
      _meta: ui,
      annotations: { ...annotations, idempotentHint: true },
    },
    ({ planId, expectedVersion }) => runPlanOperation(() => plans.prepare(planId, expectedVersion)),
  );
}

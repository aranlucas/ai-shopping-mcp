import type { MealPlanChange } from "../../src/domain/meal-plan.js";
import {
  callTool,
  parseToolResult,
  type MealPlanContent,
  type ShoppingAppClient,
  type ToolCall,
} from "../shared/types.js";
import { toolResultErrorMessage } from "./tool-calls.js";

type PlanCall = Extract<
  ToolCall,
  { name: "get_meal_plan" | "update_meal_plan" | "prepare_meal_plan" }
>;

async function callPlan(app: ShoppingAppClient | null, call: PlanCall): Promise<MealPlanContent> {
  const result = await callTool(app, call).catch(() => {
    throw new Error(
      "The response was lost. Reload the saved plan to see what was saved before changing it again. Preparing again reuses the same list.",
    );
  });

  if (result.isError) {
    throw new TypeError(
      toolResultErrorMessage(result, "The plan could not be saved. Reload it and try again."),
    );
  }

  const data = parseToolResult(result);

  if (data?.view !== "meal_plan") {
    throw new Error("The plan response was incomplete. Reload the saved plan.");
  }

  return data;
}

export function openMealPlan(app: ShoppingAppClient | null, planId: string) {
  return callPlan(app, { name: "get_meal_plan", arguments: { planId } });
}

export function changeMealPlan(
  app: ShoppingAppClient | null,
  data: MealPlanContent,
  change: MealPlanChange,
) {
  return callPlan(app, {
    name: "update_meal_plan",
    arguments: { planId: data.plan.id, expectedVersion: data.plan.version, change },
  });
}

export function prepareMealPlan(app: ShoppingAppClient | null, data: MealPlanContent) {
  return callPlan(app, {
    name: "prepare_meal_plan",
    arguments: { planId: data.plan.id, expectedVersion: data.plan.version },
  });
}

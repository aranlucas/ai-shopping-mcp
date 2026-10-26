import { App } from "@modelcontextprotocol/ext-apps";
import { describe, expect, it, vi } from "vitest";
import { appResult, type MealPlanContent } from "@/app-results.js";
import { changeMealPlan, openMealPlan, prepareMealPlan } from "../../views/app/meal-plan-calls.js";
import { createCartAction } from "../../views/app/cart-action.js";

const data: MealPlanContent = {
  view: "meal_plan",
  plan: {
    id: "plan1",
    name: "Dinner",
    storeId: "70500847",
    modality: "DELIVERY",
    meals: [
      {
        id: "m1",
        name: "Rice",
        baseServings: 2,
        servings: 2,
        ingredients: [{ name: "rice", quantity: 1, unit: "cup" }],
      },
    ],
    decisions: [],
    version: 4,
    status: "draft",
    createdAt: "2026-10-26",
    updatedAt: "2026-10-26",
  },
};

describe("meal plan view calls", () => {
  it("uses saved identities and versions; preparation never submits a cart", async () => {
    const app = new App({ name: "plan-view-test", version: "1" });

    const call = vi
      .spyOn(app, "callServerTool")
      .mockResolvedValue({ content: [], ...appResult("meal_plan", { plan: data.plan }) });

    expect(await openMealPlan(app, data.plan.id)).toEqual(data);
    await changeMealPlan(app, data, { type: "set_servings", mealId: "m1", servings: 4 });
    await prepareMealPlan(app, data);
    expect(call.mock.calls.map(([args]) => args)).toEqual([
      { name: "get_meal_plan", arguments: { planId: "plan1" } },
      {
        name: "update_meal_plan",
        arguments: {
          planId: "plan1",
          expectedVersion: 4,
          change: { type: "set_servings", mealId: "m1", servings: 4 },
        },
      },
      { name: "prepare_meal_plan", arguments: { planId: "plan1", expectedVersion: 4 } },
    ]);
  });

  it("keeps a lost response, version conflict and malformed result visible with recovery", async () => {
    const app = new App({ name: "plan-view-test", version: "1" });

    const call = vi
      .spyOn(app, "callServerTool")
      .mockRejectedValueOnce(new Error("host disconnected"))
      .mockResolvedValueOnce({
        isError: true,
        content: [{ type: "text", text: "The meal plan changed. Reload it." }],
      })
      .mockResolvedValueOnce({ content: [], structuredContent: {} });

    await expect(prepareMealPlan(app, data)).rejects.toThrow("Reload the saved plan");
    await expect(prepareMealPlan(app, data)).rejects.toThrow("meal plan changed");
    await expect(openMealPlan(app, data.plan.id)).rejects.toThrow("response was incomplete");
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("carries reviewed store and delivery through the existing cart controller", async () => {
    const app = new App({ name: "plan-view-test", version: "1" });

    const call = vi.spyOn(app, "callServerTool").mockResolvedValue({
      content: [],
      ...appResult("add_shopping_list_to_cart", {
        outcome: "added",
        requestedCount: 1,
        addedCount: 1,
        listId: "prepared-list",
        name: "Dinner",
        items: [{ upc: "0001111041700", quantity: 1, modality: "DELIVERY" }],
        needsUpc: [],
        actionDetail: "Added",
      }),
    });

    const action = createCartAction({
      kind: "list",
      listId: "prepared-list",
      storeId: "70500847",
      modality: "DELIVERY",
    });

    expect(call).not.toHaveBeenCalled();
    await action.submit(app);
    expect(call).toHaveBeenCalledWith({
      name: "add_shopping_list_to_cart",
      arguments: { listId: "prepared-list", storeId: "70500847", modality: "DELIVERY" },
    });
    expect(action.getSnapshot().status).toBe("added");
  });
});

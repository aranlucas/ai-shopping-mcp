import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { applyMealPlanChange, type MealPlan } from "../../src/domain/meal-plan.js";
import { MealPlanView, MealPlansView } from "../app/views/meal-plan.js";

const plan: MealPlan = {
  id: "p1",
  name: "Three dinners",
  storeId: "70500847",
  modality: "DELIVERY",
  meals: [
    {
      id: "m1",
      name: "Rice bowls",
      baseServings: 2,
      servings: 4,
      ingredients: [{ name: "rice", quantity: 1, unit: "cup" }],
    },
  ],
  decisions: [],
  version: 1,
  status: "draft",
  createdAt: "2026-10-26",
  updatedAt: "2026-10-26",
};

function render(value: MealPlan, canCallTools = true) {
  return renderToStaticMarkup(
    createElement(MealPlanView, {
      data: { view: "meal_plan", plan: value },
      app: null,
      setData: () => {},
      canCallTools,
    }),
  );
}

describe("meal plan review screen", () => {
  it("shows scaled units, store and modality; incomplete review disables preparation", () => {
    const html = render(plan);
    expect(html).toContain("Store 70500847");
    expect(html).toContain("DELIVERY");
    expect(html).toContain("I have all 2 cup");
    expect(html).toMatch(/disabled=""[^>]*>Prepare reviewed list/);
    expect(html).toContain("1 need review");
  });

  it("enables preparation only after review and finishes a pantry-only plan without a cart action", () => {
    const draft = applyMealPlanChange(plan, {
      type: "review_ingredient",
      key: '["rice","cup"]',
      choice: "pantry",
      pantryQuantity: 2,
    });

    const ready = { ...plan, ...draft };
    expect(render(ready)).not.toMatch(/disabled=""[^>]*>Prepare reviewed list/);
    const prepared = render({ ...ready, status: "prepared" });
    expect(prepared).toContain("no purchases needed");
    expect(prepared).not.toContain("Open shopping list");
    expect(prepared).not.toContain("Prepare reviewed list");
    expect(prepared).toMatch(/disabled=""[^>]*>Save servings/);
  });

  it("shows stale choices as previous selections and escapes recipe content", () => {
    const draft = applyMealPlanChange(plan, {
      type: "review_ingredient",
      key: '["rice","cup"]',
      choice: "buy",
      pantryQuantity: 0,
      product: { upc: "0001111041700", productName: "Rice", packages: 1 },
    });

    const changed = applyMealPlanChange(draft, { type: "set_servings", mealId: "m1", servings: 6 });
    const html = render({ ...plan, ...changed, name: "<script>alert(1)</script>" });
    expect(html).toContain("Previous choice: Rice");
    expect(html).toContain("stale");
    expect(html).not.toContain("<script>");
    expect(html).toMatch(/disabled=""[^>]*>Prepare reviewed list/);
  });

  it("offers a saved list without performing checkout and handles an empty plan index", () => {
    const html = render({ ...plan, status: "prepared", shoppingListId: "list1" });
    expect(html).toContain("Open shopping list");
    expect(html).toContain("separate action");

    const empty = renderToStaticMarkup(
      createElement(MealPlansView, {
        data: { view: "meal_plans", plans: [] },
        app: null,
        setData: () => {},
        canCallTools: false,
      }),
    );

    expect(empty).toContain("Ask your assistant to plan your dinners");
    expect(render(plan, false)).toMatch(/disabled=""[^>]*>Reload saved plan/);
  });
});

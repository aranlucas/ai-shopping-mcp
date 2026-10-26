import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { aggregateMealPlan, type MealPlanDraft } from "@/domain/meal-plan.js";
import { createD1MealPlanStore } from "@/utils/d1-meal-plan-storage.js";
import { createD1ShoppingStore } from "@/utils/d1-shopping-storage.js";
import { ensureShoppingSchema } from "@test/d1-schema.js";

beforeAll(ensureShoppingSchema);

function shopper() {
  const userId = crypto.randomUUID();

  return {
    plans: createD1MealPlanStore(env.SHOPPING_DB, userId),
    lists: createD1ShoppingStore(env.SHOPPING_DB, userId).shoppingList,
  };
}

const draft: MealPlanDraft = {
  name: "Three dinners",
  storeId: "70500847",
  modality: "DELIVERY",
  meals: [
    {
      id: "m1",
      name: "Beans and rice",
      baseServings: 2,
      servings: 2,
      ingredients: [{ name: "rice", quantity: 1, unit: "cup" }],
    },
    {
      id: "m2",
      name: "Rice bowl",
      baseServings: 2,
      servings: 2,
      ingredients: [{ name: "rice", quantity: 0.5, unit: "cup" }],
    },
    {
      id: "m3",
      name: "Rice soup",
      baseServings: 2,
      servings: 2,
      ingredients: [{ name: "rice", quantity: 0.5, unit: "cup" }],
    },
  ],
  decisions: [],
};

async function reviewed(plans: ReturnType<typeof shopper>["plans"], pantry = false) {
  const plan = await plans.create(draft);
  const ingredient = aggregateMealPlan(plan).ingredients[0];

  return plans.update(plan.id, plan.version, {
    type: "review_ingredient",
    key: ingredient.key,
    choice: pantry ? "pantry" : "buy",
    pantryQuantity: pantry ? 2 : 1,
    product: pantry
      ? undefined
      : { upc: "0001111041700", productName: "Rice", packages: 1, price: 2.5 },
  });
}

describe("saved meal plans", () => {
  it("resumes meal choices and isolates every operation by shopper", async () => {
    const user = shopper();
    const other = shopper();
    const plan = await reviewed(user.plans);
    expect(await user.plans.get(plan.id)).toEqual(plan);
    expect(await user.plans.list()).toMatchObject([{ id: plan.id, mealCount: 3, status: "draft" }]);
    expect(await other.plans.list()).toEqual([]);
    await expect(other.plans.get(plan.id)).rejects.toThrow("No meal plan");
    await expect(
      other.plans.update(plan.id, plan.version, { type: "remove_meal", mealId: "m1" }),
    ).rejects.toThrow("No meal plan");
    await expect(other.plans.prepare(plan.id, plan.version)).rejects.toThrow("No meal plan");
  });

  it("rejects outdated concurrent edits without losing the winning choice", async () => {
    const { plans } = shopper();
    const plan = await plans.create(draft);

    const outcomes = await Promise.allSettled([
      plans.update(plan.id, plan.version, { type: "set_servings", mealId: "m1", servings: 4 }),
      plans.update(plan.id, plan.version, { type: "set_servings", mealId: "m2", servings: 6 }),
    ]);

    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(1);
    const saved = await plans.get(plan.id);
    expect(saved.version).toBe(2);
    expect(saved.meals.filter((meal) => meal.servings !== 2)).toHaveLength(1);
  });

  it("requires review again after servings change and preserves unrelated meals", async () => {
    const { plans, lists } = shopper();
    const plan = await reviewed(plans);

    const changed = await plans.update(plan.id, plan.version, {
      type: "set_servings",
      mealId: "m1",
      servings: 4,
    });

    expect(changed.meals.slice(1)).toEqual(plan.meals.slice(1));
    expect(aggregateMealPlan(changed)).toMatchObject({ ready: false, unresolvedCount: 1 });
    await expect(plans.prepare(changed.id, changed.version)).rejects.toThrow(
      "Review every current ingredient",
    );
    expect(await lists.list()).toEqual([]);
  });

  it("prepares exactly one reviewed list across simultaneous calls and lost-response retries", async () => {
    const { plans, lists } = shopper();
    const plan = await reviewed(plans);

    const prepared = await Promise.all(
      Array.from({ length: 5 }, () => plans.prepare(plan.id, plan.version)),
    );

    expect(new Set(prepared.map((item) => item.shoppingListId)).size).toBe(1);
    expect(await lists.list()).toHaveLength(1);
    const result = prepared[0];
    expect(result).toMatchObject({ status: "prepared", version: 3 });
    expect(await plans.prepare(plan.id, plan.version)).toEqual(result);

    if (!result.shoppingListId) {
      throw new Error("Expected a prepared shopping list");
    }

    expect(await lists.get(result.shoppingListId)).toMatchObject({
      fulfillment: { storeId: "70500847", modality: "DELIVERY" },
      items: [{ upc: "0001111041700", quantity: 1, price: 2.5, checked: false }],
    });
    await expect(
      plans.update(result.id, result.version, { type: "set_servings", mealId: "m1", servings: 4 }),
    ).rejects.toThrow("already prepared");
  });

  it("allows either an edit or preparation to win, never a stale or orphaned list", async () => {
    const { plans, lists } = shopper();
    const plan = await reviewed(plans);

    const outcomes = await Promise.allSettled([
      plans.update(plan.id, plan.version, { type: "set_servings", mealId: "m1", servings: 4 }),
      plans.prepare(plan.id, plan.version),
    ]);

    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    const saved = await plans.get(plan.id);
    expect(await lists.list()).toHaveLength(saved.status === "prepared" ? 1 : 0);
    expect(saved.version).toBe(3);
  });

  it("finishes a pantry-only plan without creating a shopping list", async () => {
    const { plans, lists } = shopper();
    const plan = await reviewed(plans, true);
    const prepared = await plans.prepare(plan.id, plan.version);
    expect(prepared).toMatchObject({ status: "prepared" });
    expect(prepared.shoppingListId).toBeUndefined();
    expect(await lists.list()).toEqual([]);
    expect(await plans.prepare(plan.id, plan.version)).toEqual(prepared);
  });

  it("rolls back the plan claim if inserting its list fails", async () => {
    const { plans, lists } = shopper();
    const plan = await reviewed(plans);
    await env.SHOPPING_DB.exec(
      "CREATE TRIGGER reject_meal_list BEFORE INSERT ON shopping_lists BEGIN SELECT RAISE(ABORT, 'test list insert failure'); END",
    );

    try {
      await expect(plans.prepare(plan.id, plan.version)).rejects.toThrow(
        "test list insert failure",
      );
      expect(await plans.get(plan.id)).toEqual(plan);
      expect(await lists.list()).toEqual([]);
    } finally {
      await env.SHOPPING_DB.exec("DROP TRIGGER reject_meal_list");
    }

    expect(await plans.prepare(plan.id, plan.version)).toMatchObject({ status: "prepared" });
  });
});

import { describe, expect, it } from "vitest";
import {
  aggregateMealPlan,
  applyMealPlanChange,
  mealPlanChangeSchema,
  mealPlanDecisionSchema,
  mealPlanDraftSchema,
  mealPlanItems,
  mealPlanSchema,
  mealSchema,
  MealPlanValidationError,
  type MealPlanChange,
  type MealPlanDraft,
} from "@/domain/meal-plan.js";

const riceKey = JSON.stringify(["rice", "cup"]);
const beansKey = JSON.stringify(["beans", "can"]);
const lentilsKey = JSON.stringify(["lentils", "g"]);
const broccoliKey = JSON.stringify(["broccoli", "head"]);

type ReviewIngredientChange = Extract<MealPlanChange, { type: "review_ingredient" }>;

function dinnerPlan(): MealPlanDraft {
  return mealPlanDraftSchema.parse({
    name: "Three dinners",
    storeId: "70500874",
    modality: "PICKUP",
    meals: [
      {
        id: "bowls",
        name: "Rice bowls",
        baseServings: 2,
        servings: 2,
        ingredients: [
          { name: "Rice", quantity: 1, unit: "cup" },
          { name: "Beans", quantity: 2, unit: "can" },
        ],
      },
      {
        id: "curry",
        name: "Lentil curry",
        baseServings: 4,
        servings: 2,
        ingredients: [
          { name: " rice ", quantity: 2, unit: " CUP " },
          { name: "Lentils", quantity: 200, unit: "g" },
        ],
      },
      {
        id: "stir-fry",
        name: "Broccoli stir-fry",
        baseServings: 2,
        servings: 4,
        ingredients: [
          { name: "RICE", quantity: 0.5, unit: "cup" },
          { name: "Broccoli", quantity: 1, unit: "head" },
        ],
      },
    ],
  });
}

function planIngredient(draft: MealPlanDraft, key: string) {
  const ingredient = aggregateMealPlan(draft).ingredients.find((item) => item.key === key);

  if (!ingredient) {
    throw new Error(`Missing test ingredient: ${key}`);
  }

  return ingredient;
}

function buyChange(
  key: string,
  overrides?: Partial<ReviewIngredientChange>,
): ReviewIngredientChange {
  return {
    type: "review_ingredient",
    key,
    pantryQuantity: 0,
    choice: "buy",
    product: { upc: "1", productName: "Bag of rice", packages: 2, price: 3.25 },
    ...overrides,
  };
}

function reviewedPlan(draft = dinnerPlan()): MealPlanDraft {
  return aggregateMealPlan(draft).ingredients.reduce(
    (plan, ingredient, index) =>
      applyMealPlanChange(
        plan,
        buyChange(ingredient.key, {
          product: {
            upc: String(index + 1),
            productName: ingredient.name,
            packages: 1,
            price: 2,
          },
        }),
      ),
    draft,
  );
}

describe("meal-plan schemas", () => {
  it("normalizes bounded names, units, store IDs and UPCs without generating IDs", () => {
    const plan = dinnerPlan();

    const parsed = mealPlanDraftSchema.parse({
      ...plan,
      name: "  Dinners  ",
      storeId: " 70500874 ",
    });

    expect(parsed).toMatchObject({ name: "Dinners", storeId: "70500874" });
    expect(parsed.meals[1]).toMatchObject({
      id: "curry",
      ingredients: [{ name: "rice", quantity: 2, unit: "CUP" }, { name: "Lentils" }],
    });
    const reviewed = applyMealPlanChange(plan, buyChange(riceKey));
    expect(reviewed.decisions[0]?.product?.upc).toBe("0000000000001");
  });

  it("defaults draft decisions and review pantry allocations", () => {
    expect(dinnerPlan().decisions).toEqual([]);
    expect(
      mealPlanChangeSchema.parse({
        type: "review_ingredient",
        key: riceKey,
        choice: "exclude",
        reason: "Skip",
      }),
    ).toMatchObject({ pantryQuantity: 0 });

    const plan = applyMealPlanChange(dinnerPlan(), {
      type: "review_ingredient",
      key: riceKey,
      choice: "exclude",
      reason: "Use leftovers",
    });

    expect(planIngredient(plan, riceKey)).toMatchObject({ state: "excluded", pantryQuantity: 0 });
  });

  it("parses persisted metadata alongside the draft", () => {
    const metadata = {
      id: "plan-1",
      version: 2,
      status: "prepared",
      shoppingListId: "list-1",
      createdAt: "2026-10-26T10:00:00Z",
      updatedAt: "2026-10-26T11:00:00Z",
    };

    expect(mealPlanSchema.parse({ ...dinnerPlan(), ...metadata })).toMatchObject(metadata);
    expect(mealPlanSchema.safeParse({ ...dinnerPlan(), ...metadata, version: 0 }).success).toBe(
      false,
    );
    expect(mealPlanSchema.safeParse({ ...dinnerPlan(), ...metadata, version: 1.5 }).success).toBe(
      false,
    );
    expect(
      mealPlanSchema.safeParse({ ...dinnerPlan(), ...metadata, status: "submitted" }).success,
    ).toBe(false);
  });

  it.each([
    { id: " " },
    { name: " " },
    { name: "x".repeat(201) },
    { baseServings: 0 },
    { baseServings: 51 },
    { servings: 1.5 },
    { servings: 0 },
    { servings: 51 },
    { ingredients: [{ name: "Rice", quantity: 0, unit: "cup" }] },
    { ingredients: [{ name: "Rice", quantity: -1, unit: "cup" }] },
    { ingredients: [{ name: "Rice", quantity: Number.POSITIVE_INFINITY, unit: "cup" }] },
    { ingredients: [{ name: "Rice", quantity: Number.NaN, unit: "cup" }] },
    { ingredients: [{ name: "Rice", quantity: 1_000_001, unit: "cup" }] },
    { ingredients: [{ name: " ", quantity: 1, unit: "cup" }] },
    { ingredients: [{ name: "Rice", quantity: 1, unit: " " }] },
    { ingredients: [{ name: "Rice", quantity: 1, unit: "x".repeat(81) }] },
    { ingredients: Array.from({ length: 41 }, () => ({ name: "Rice", quantity: 1, unit: "cup" })) },
  ])("rejects invalid meal bounds: %j", (patch) => {
    expect(mealSchema.safeParse({ ...dinnerPlan().meals[0], ...patch }).success).toBe(false);
  });

  it("accepts the meal and quantity upper bounds", () => {
    const meal = mealSchema.parse({
      id: "large",
      name: "Large dinner",
      baseServings: 50,
      servings: 50,
      ingredients: Array.from({ length: 40 }, () => ({
        name: "Rice",
        quantity: 1_000_000,
        unit: "g",
      })),
    });

    const meals = Array.from({ length: 7 }, (_, index) => ({ ...meal, id: String(index) }));
    expect(mealPlanDraftSchema.safeParse({ ...dinnerPlan(), meals }).success).toBe(true);
  });

  it.each([{ name: " " }, { storeId: "123" }, { modality: "SHIP" }, { meals: [] }])(
    "rejects invalid draft fields: %j",
    (patch) => {
      expect(mealPlanDraftSchema.safeParse({ ...dinnerPlan(), ...patch }).success).toBe(false);
    },
  );

  it("rejects too many meals and duplicate meal IDs", () => {
    const plan = dinnerPlan();
    const meal = plan.meals[0];
    const meals = Array.from({ length: 8 }, (_, index) => ({ ...meal, id: String(index) }));
    expect(mealPlanDraftSchema.safeParse({ ...plan, meals }).success).toBe(false);
    expect(mealPlanDraftSchema.safeParse({ ...plan, meals: [...plan.meals, meal] }).success).toBe(
      false,
    );
  });

  it.each([
    { requiredQuantity: 0 },
    { requiredQuantity: Number.POSITIVE_INFINITY },
    { pantryQuantity: -1 },
    { pantryQuantity: Number.NaN },
    { pantryQuantity: 4 },
    { pantryQuantity: 3 },
    { product: undefined },
    { storeId: undefined },
    { storeId: "short" },
    { product: { upc: "abc", productName: "Rice", packages: 1 } },
    { product: { upc: "1", productName: " ", packages: 1 } },
    { product: { upc: "1", productName: "Rice", packages: 0 } },
    { product: { upc: "1", productName: "Rice", packages: 1000 } },
    { product: { upc: "1", productName: "Rice", packages: 1.5 } },
    { product: { upc: "1", productName: "Rice", packages: 1, price: -1 } },
    { product: { upc: "1", productName: "Rice", packages: 1, price: Number.POSITIVE_INFINITY } },
    { choice: "pantry", pantryQuantity: 2 },
    { choice: "exclude", reason: undefined },
    { choice: "exclude", reason: " " },
  ])("rejects invalid review decisions: %j", (patch) => {
    expect(
      mealPlanDecisionSchema.safeParse({
        key: riceKey,
        requiredQuantity: 3,
        pantryQuantity: 0,
        choice: "buy",
        storeId: "70500874",
        product: { upc: "1", productName: "Rice", packages: 1 },
        ...patch,
      }).success,
    ).toBe(false);
  });

  it("rejects caller-supplied review basis", () => {
    expect(
      mealPlanChangeSchema.safeParse({ ...buyChange(riceKey), reviewedRequiredQuantity: 1 })
        .success,
    ).toBe(false);
    expect(
      mealPlanChangeSchema.safeParse({ ...buyChange(riceKey), requiredQuantity: 1 }).success,
    ).toBe(false);
    expect(
      mealPlanChangeSchema.safeParse({ ...buyChange(riceKey), storeId: "99999999" }).success,
    ).toBe(false);
  });
});

describe("meal-plan aggregation", () => {
  it("scales and combines an exact ingredient shared by three dinners", () => {
    const result = aggregateMealPlan(dinnerPlan());
    expect(result).toMatchObject({ unresolvedCount: 4, ready: false });
    expect(result.ingredients).toHaveLength(4);
    expect(planIngredient(dinnerPlan(), riceKey)).toEqual({
      key: riceKey,
      name: "Rice",
      unit: "cup",
      requiredQuantity: 3,
      pantryQuantity: 0,
      remainingQuantity: 3,
      state: "unresolved",
      sources: [
        { mealId: "bowls", mealName: "Rice bowls", quantity: 1 },
        { mealId: "curry", mealName: "Lentil curry", quantity: 1 },
        { mealId: "stir-fry", mealName: "Broccoli stir-fry", quantity: 1 },
      ],
    });
    expect(result.ingredients.map((ingredient) => ingredient.requiredQuantity)).toEqual([
      3, 2, 100, 2,
    ]);
    expect(aggregateMealPlan(dinnerPlan())).toEqual(result);
  });

  it("keeps units and plural forms distinct and keys unambiguous", () => {
    const plan = dinnerPlan();

    const meal = mealSchema.parse({
      ...plan.meals[0],
      ingredients: [
        { name: "Rice", quantity: 1, unit: "g" },
        { name: "Rice", quantity: 1, unit: "cup" },
        { name: "Rice", quantity: 1, unit: "cups" },
        { name: "Rices", quantity: 1, unit: "cup" },
        { name: "a,b", quantity: 1, unit: "c" },
        { name: "a", quantity: 1, unit: "b,c" },
      ],
    });

    const ingredients = aggregateMealPlan({ ...plan, meals: [meal] }).ingredients;
    expect(ingredients).toHaveLength(6);
    expect(new Set(ingredients.map((ingredient) => ingredient.key)).size).toBe(6);
    expect(ingredients.map((ingredient) => ingredient.requiredQuantity)).toEqual([
      1, 1, 1, 1, 1, 1,
    ]);
  });

  it("retains tiny positive requirements and removes floating-point sum noise", () => {
    const plan = dinnerPlan();

    const meal = mealSchema.parse({
      ...plan.meals[0],
      baseServings: 50,
      servings: 1,
      ingredients: [
        { name: "Spice", quantity: 1e-12, unit: "g" },
        { name: "Trace", quantity: Number.MIN_VALUE, unit: "g" },
        { name: "Salt", quantity: 0.1, unit: "g" },
        { name: "Salt", quantity: 0.2, unit: "g" },
      ],
    });

    const ingredients = aggregateMealPlan({ ...plan, meals: [meal] }).ingredients;
    expect(ingredients.map((ingredient) => ingredient.requiredQuantity)).toEqual([
      2e-14,
      Number.MIN_VALUE,
      0.006,
    ]);
  });

  it("treats an ingredient-free meal as resolved without purchases", () => {
    const plan = dinnerPlan();
    const meal = mealSchema.parse({ ...plan.meals[0], ingredients: [] });
    const empty = { ...plan, meals: [meal] };
    expect(aggregateMealPlan(empty)).toEqual({ ingredients: [], unresolvedCount: 0, ready: true });
    expect(mealPlanItems(empty)).toEqual([]);
  });

  it("rejects duplicate review keys rather than silently selecting one", () => {
    const plan = applyMealPlanChange(dinnerPlan(), buyChange(riceKey));
    expect(() =>
      aggregateMealPlan({ ...plan, decisions: [...plan.decisions, ...plan.decisions] }),
    ).toThrow(MealPlanValidationError);
  });
});

describe("meal-plan edits and reviews", () => {
  it("scales only affected totals and preserves unrelated meals and review decisions", () => {
    const plan = reviewedPlan();

    const changed = applyMealPlanChange(plan, {
      type: "set_servings",
      mealId: "bowls",
      servings: 4,
    });

    expect(changed.meals.slice(1)).toEqual(plan.meals.slice(1));
    expect(changed.decisions).toEqual(plan.decisions);
    expect(planIngredient(changed, riceKey)).toMatchObject({ requiredQuantity: 4, state: "stale" });
    expect(planIngredient(changed, beansKey)).toMatchObject({
      requiredQuantity: 4,
      state: "stale",
    });
    expect(planIngredient(changed, lentilsKey)).toEqual(planIngredient(plan, lentilsKey));
    expect(planIngredient(changed, broccoliKey)).toEqual(planIngredient(plan, broccoliKey));
    expect(aggregateMealPlan(changed)).toMatchObject({ unresolvedCount: 2, ready: false });
    expect(() => mealPlanItems(changed)).toThrow(MealPlanValidationError);
  });

  it("keeps decisions current when the requirement stays the same", () => {
    const plan = reviewedPlan();
    const same = applyMealPlanChange(plan, { type: "set_servings", mealId: "bowls", servings: 2 });
    expect(aggregateMealPlan(same)).toEqual(aggregateMealPlan(plan));
  });

  it("records current quantity and store, replacing just the reviewed decision", () => {
    const plan = reviewedPlan();

    const changed = applyMealPlanChange(plan, {
      type: "set_servings",
      mealId: "bowls",
      servings: 4,
    });

    const reviewed = applyMealPlanChange(changed, buyChange(riceKey, { pantryQuantity: 1 }));
    expect(planIngredient(reviewed, riceKey)).toMatchObject({
      state: "ready",
      requiredQuantity: 4,
      pantryQuantity: 1,
      remainingQuantity: 3,
      decision: { requiredQuantity: 4, pantryQuantity: 1, storeId: "70500874" },
    });
    expect(reviewed.decisions).toHaveLength(plan.decisions.length);
    expect(reviewed.decisions.filter((decision) => decision.key !== riceKey)).toEqual(
      changed.decisions.filter((decision) => decision.key !== riceKey),
    );
  });

  it("uses only explicit pantry allocation, never inventory or package conversion", () => {
    const plan = applyMealPlanChange(dinnerPlan(), buyChange(riceKey, { pantryQuantity: 2.5 }));
    expect(planIngredient(plan, riceKey)).toMatchObject({
      requiredQuantity: 3,
      pantryQuantity: 2.5,
      remainingQuantity: 0.5,
      state: "ready",
      decision: { product: { packages: 2 } },
    });
    expect(planIngredient(plan, beansKey)).toMatchObject({
      pantryQuantity: 0,
      remainingQuantity: 2,
    });
  });

  it("requires full allocation for pantry and an explicit reason for exclusion", () => {
    const plan = dinnerPlan();

    const pantry = applyMealPlanChange(plan, {
      type: "review_ingredient",
      key: riceKey,
      pantryQuantity: 3,
      choice: "pantry",
    });

    expect(planIngredient(pantry, riceKey)).toMatchObject({
      state: "pantry",
      pantryQuantity: 3,
      remainingQuantity: 0,
    });

    const excluded = applyMealPlanChange(pantry, {
      type: "review_ingredient",
      key: beansKey,
      pantryQuantity: 0,
      choice: "exclude",
      reason: " Already cooked ",
    });

    expect(planIngredient(excluded, beansKey)).toMatchObject({
      state: "excluded",
      decision: { reason: "Already cooked" },
    });
    expect(planIngredient(excluded, riceKey)).toEqual(planIngredient(pantry, riceKey));
  });

  it.each([
    { pantryQuantity: 4 },
    { pantryQuantity: 3 },
    { pantryQuantity: -1 },
    { product: undefined },
    { choice: "pantry", pantryQuantity: 2 },
    { choice: "exclude", reason: undefined },
    { choice: "exclude", reason: " " },
  ] satisfies Array<Partial<ReviewIngredientChange>>)(
    "rejects impossible review choices: %j",
    (patch) => {
      expect(() => applyMealPlanChange(dinnerPlan(), buyChange(riceKey, patch))).toThrow(
        MealPlanValidationError,
      );
    },
  );

  it("retains an oversized previous pantry allocation as a stale suggestion", () => {
    const plan = applyMealPlanChange(dinnerPlan(), {
      type: "review_ingredient",
      key: riceKey,
      pantryQuantity: 3,
      choice: "pantry",
    });

    const changed = applyMealPlanChange(plan, {
      type: "set_servings",
      mealId: "stir-fry",
      servings: 2,
    });

    expect(planIngredient(changed, riceKey)).toMatchObject({
      state: "stale",
      requiredQuantity: 2.5,
      pantryQuantity: 0,
      remainingQuantity: 2.5,
      decision: { pantryQuantity: 3, requiredQuantity: 3 },
    });
  });

  it("stales buy decisions after a store edit while retaining pantry and exclusion decisions", () => {
    let plan = reviewedPlan();
    plan = applyMealPlanChange(plan, {
      type: "review_ingredient",
      key: beansKey,
      pantryQuantity: 2,
      choice: "pantry",
    });
    plan = applyMealPlanChange(plan, {
      type: "review_ingredient",
      key: lentilsKey,
      pantryQuantity: 0,
      choice: "exclude",
      reason: "Use leftovers",
    });

    const changed = applyMealPlanChange(plan, {
      type: "set_store",
      storeId: "99999999",
      modality: "DELIVERY",
    });

    expect(changed).toMatchObject({
      storeId: "99999999",
      modality: "DELIVERY",
      decisions: plan.decisions,
    });
    expect(aggregateMealPlan(changed)).toMatchObject({ unresolvedCount: 2, ready: false });
    expect(planIngredient(changed, riceKey)).toMatchObject({
      state: "stale",
      decision: { storeId: "70500874" },
    });
    expect(planIngredient(changed, beansKey).state).toBe("pantry");
    expect(planIngredient(changed, lentilsKey).state).toBe("excluded");
    expect(() => mealPlanItems(changed)).toThrow(MealPlanValidationError);
    const reviewed = applyMealPlanChange(changed, buyChange(riceKey));
    expect(planIngredient(reviewed, riceKey)).toMatchObject({
      state: "ready",
      decision: { storeId: "99999999" },
    });
  });

  it("preserves modality when omitted and does not stale same-store reviews", () => {
    const plan = reviewedPlan();

    const sameStore = applyMealPlanChange(plan, {
      type: "set_store",
      storeId: plan.storeId,
      modality: "DELIVERY",
    });

    expect(aggregateMealPlan(sameStore).ready).toBe(true);
    const changedStore = applyMealPlanChange(sameStore, { type: "set_store", storeId: "99999999" });
    expect(changedStore.modality).toBe("DELIVERY");
  });

  it("replaces one meal and keeps unrelated choices while new ingredients need review", () => {
    const plan = reviewedPlan();

    const meal = mealSchema.parse({
      ...plan.meals[0],
      name: "Pasta bowls",
      ingredients: [{ name: "Pasta", quantity: 250, unit: "g" }],
    });

    const changed = applyMealPlanChange(plan, { type: "replace_meal", meal });
    expect(changed.meals.slice(1)).toEqual(plan.meals.slice(1));
    expect(changed.decisions).toEqual(plan.decisions);
    expect(planIngredient(changed, riceKey)).toMatchObject({ requiredQuantity: 2, state: "stale" });
    expect(planIngredient(changed, lentilsKey)).toEqual(planIngredient(plan, lentilsKey));
    expect(planIngredient(changed, JSON.stringify(["pasta", "g"])).state).toBe("unresolved");
    expect(
      aggregateMealPlan(changed).ingredients.map((ingredient) => ingredient.key),
    ).not.toContain(beansKey);
  });

  it("adds and removes meals without turning removed ingredients into purchases", () => {
    const plan = reviewedPlan();
    const removed = applyMealPlanChange(plan, { type: "remove_meal", mealId: "bowls" });
    const resolved = applyMealPlanChange(removed, buyChange(riceKey));
    expect(resolved.decisions.some((decision) => decision.key === beansKey)).toBe(true);
    expect(mealPlanItems(resolved).map((item) => item.productName)).not.toContain("Beans");

    const meal = mealSchema.parse({
      id: "soup",
      name: "Soup",
      baseServings: 1,
      servings: 1,
      ingredients: [{ name: "Carrot", quantity: 1, unit: "whole" }],
    });

    const added = applyMealPlanChange(resolved, { type: "add_meal", meal });
    expect(added.meals).toHaveLength(3);
    expect(added.decisions).toEqual(resolved.decisions);
    expect(planIngredient(added, JSON.stringify(["carrot", "whole"])).state).toBe("unresolved");
  });

  it.each([
    { type: "set_servings", mealId: "missing", servings: 2 },
    { type: "remove_meal", mealId: "missing" },
    { type: "set_servings", mealId: "bowls", servings: 0 },
    { type: "set_servings", mealId: "bowls", servings: 51 },
    { type: "set_servings", mealId: "bowls", servings: 1.5 },
    { type: "set_store", storeId: "bad" },
    {
      type: "review_ingredient",
      key: "unknown",
      pantryQuantity: 0,
      choice: "exclude",
      reason: "Skip",
    },
  ] satisfies MealPlanChange[])("rejects invalid edits: %j", (change) => {
    expect(() => applyMealPlanChange(dinnerPlan(), change)).toThrow(MealPlanValidationError);
  });

  it("rejects replacing a missing meal, duplicate IDs, excess meals and removing the final meal", () => {
    const plan = dinnerPlan();
    const meal = mealSchema.parse(plan.meals[0]);
    expect(() =>
      applyMealPlanChange(plan, { type: "replace_meal", meal: { ...meal, id: "missing" } }),
    ).toThrow(MealPlanValidationError);
    expect(() => applyMealPlanChange(plan, { type: "add_meal", meal })).toThrow(
      MealPlanValidationError,
    );

    const full = {
      ...plan,
      meals: Array.from({ length: 7 }, (_, index) => ({ ...meal, id: String(index) })),
    };

    expect(() =>
      applyMealPlanChange(full, { type: "add_meal", meal: { ...meal, id: "extra" } }),
    ).toThrow(MealPlanValidationError);
    expect(() =>
      applyMealPlanChange({ ...plan, meals: [meal] }, { type: "remove_meal", mealId: meal.id }),
    ).toThrow(MealPlanValidationError);
  });

  it("rejects reviewing an ingredient that has been removed", () => {
    const plan = applyMealPlanChange(dinnerPlan(), { type: "remove_meal", mealId: "bowls" });
    expect(() => applyMealPlanChange(plan, buyChange(beansKey))).toThrow(MealPlanValidationError);
  });
});

describe("meal-plan shopping items", () => {
  it("rejects an unresolved plan and productless buy choices", () => {
    expect(() => mealPlanItems(dinnerPlan())).toThrow(MealPlanValidationError);
    expect(() =>
      applyMealPlanChange(dinnerPlan(), buyChange(riceKey, { product: undefined })),
    ).toThrow(MealPlanValidationError);
  });

  it("allows a fully pantry/excluded plan with zero purchases", () => {
    const plan = aggregateMealPlan(dinnerPlan()).ingredients.reduce(
      (draft, ingredient, index) =>
        applyMealPlanChange(draft, {
          type: "review_ingredient",
          key: ingredient.key,
          pantryQuantity: index % 2 === 0 ? ingredient.requiredQuantity : 0,
          choice: index % 2 === 0 ? "pantry" : "exclude",
          reason: "Use an already cooked dinner",
        }),
      dinnerPlan(),
    );

    expect(aggregateMealPlan(plan)).toMatchObject({ unresolvedCount: 0, ready: true });
    expect(mealPlanItems(plan)).toEqual([]);
  });

  it("merges identical UPCs by explicit package count while retaining unit price", () => {
    const plan = applyMealPlanChange(
      reviewedPlan(),
      buyChange(riceKey, {
        pantryQuantity: 2.9,
        product: { upc: "2", productName: "Beans", packages: 7, price: 2 },
      }),
    );

    expect(mealPlanItems(plan)).toEqual([
      { upc: "0000000000002", productName: "Beans", quantity: 8, price: 2 },
      { upc: "0000000000003", productName: "Lentils", quantity: 1, price: 2 },
      { upc: "0000000000004", productName: "Broccoli", quantity: 1, price: 2 },
    ]);
  });

  it.each([1, 3, undefined])("omits conflicting or partially missing prices (%s)", (price) => {
    const plan = applyMealPlanChange(
      reviewedPlan(),
      buyChange(riceKey, {
        product: { upc: "2", productName: "Beans", packages: 1, price },
      }),
    );

    expect(mealPlanItems(plan)[0]).toEqual({
      upc: "0000000000002",
      productName: "Beans",
      quantity: 2,
    });
  });

  it("does not restore a price after an earlier conflict", () => {
    let plan = applyMealPlanChange(
      reviewedPlan(),
      buyChange(riceKey, {
        product: { upc: "2", productName: "Beans", packages: 1, price: 3 },
      }),
    );

    plan = applyMealPlanChange(
      plan,
      buyChange(lentilsKey, {
        product: { upc: "2", productName: "Beans", packages: 1, price: 2 },
      }),
    );
    expect(mealPlanItems(plan)[0]).toEqual({
      upc: "0000000000002",
      productName: "Beans",
      quantity: 3,
    });
  });

  it("preserves a reviewed zero price", () => {
    const plan = applyMealPlanChange(
      reviewedPlan(),
      buyChange(riceKey, {
        product: { upc: "1", productName: "Rice", packages: 3, price: 0 },
      }),
    );

    expect(mealPlanItems(plan)[0]).toEqual({
      upc: "0000000000001",
      productName: "Rice",
      quantity: 3,
      price: 0,
    });
  });

  it("rejects conflicting names for a UPC", () => {
    const plan = applyMealPlanChange(
      reviewedPlan(),
      buyChange(riceKey, {
        product: { upc: "2", productName: "Different product", packages: 1 },
      }),
    );

    expect(() => mealPlanItems(plan)).toThrow(MealPlanValidationError);
  });

  it("allows a merged total of 999 packages and rejects overflow", () => {
    const valid = applyMealPlanChange(
      reviewedPlan(),
      buyChange(riceKey, {
        product: { upc: "2", productName: "Beans", packages: 998, price: 2 },
      }),
    );

    expect(mealPlanItems(valid)[0]?.quantity).toBe(999);

    const invalid = applyMealPlanChange(
      valid,
      buyChange(riceKey, {
        product: { upc: "2", productName: "Beans", packages: 999, price: 2 },
      }),
    );

    expect(() => mealPlanItems(invalid)).toThrow(MealPlanValidationError);
  });

  it("does not mutate plans, changes, decisions or previously returned items", () => {
    const plan = reviewedPlan();
    const original = structuredClone(plan);

    const change = buyChange(riceKey, {
      product: { upc: "2", productName: "Beans", packages: 2, price: 2 },
    });

    const originalChange = structuredClone(change);
    const firstItems = mealPlanItems(plan);
    const firstSnapshot = structuredClone(firstItems);
    const changed = applyMealPlanChange(plan, change);
    aggregateMealPlan(changed);
    mealPlanItems(changed);
    expect(plan).toEqual(original);
    expect(change).toEqual(originalChange);
    expect(firstItems).toEqual(firstSnapshot);
    changed.meals[0]?.ingredients.push({ name: "Extra", quantity: 1, unit: "g" });
    expect(plan).toEqual(original);
    expect(changed.decisions).not.toBe(plan.decisions);
  });

  it("does not mutate input on an invalid edit", () => {
    const plan = reviewedPlan();
    const original = structuredClone(plan);
    expect(() => applyMealPlanChange(plan, buyChange(riceKey, { pantryQuantity: 4 }))).toThrow(
      MealPlanValidationError,
    );
    expect(plan).toEqual(original);
  });
});

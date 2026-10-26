import type { Client } from "@modelcontextprotocol/client";
import { reset } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appPayloadSchemas } from "@/app-results.js";
import { aggregateMealPlan, type MealPlanChange, type MealPlan } from "@/domain/meal-plan.js";
import {
  createEvalMcpClient,
  installKrogerFetchStub,
  type KrogerFetchStub,
  type ToolCallResult,
  DEFAULT_STORE_ID,
} from "@test/evals/harness.js";

function planOf(result: ToolCallResult): MealPlan {
  expect(result.isError).not.toBe(true);

  return appPayloadSchemas.meal_plan.parse(result.structuredContent).plan;
}

describe("saved dinner plan to reviewed cart (real MCP wire, fixture Kroger)", () => {
  let client: Client;
  let stub: KrogerFetchStub;
  beforeEach(async () => {
    stub = installKrogerFetchStub();
    client = await createEvalMcpClient();
  });
  afterEach(async () => {
    await client.close();
    stub.restore();
    await reset();
  });

  async function create() {
    return planOf(
      await client.callTool({
        name: "create_meal_plan",
        arguments: {
          name: "Three dinners",
          storeId: DEFAULT_STORE_ID,
          modality: "DELIVERY",
          meals: [
            {
              name: "Pancakes",
              baseServings: 2,
              servings: 2,
              ingredients: [
                { name: "milk", quantity: 1, unit: "cup" },
                { name: "eggs", quantity: 2, unit: "egg" },
              ],
            },
            {
              name: "Mac and cheese",
              baseServings: 2,
              servings: 2,
              ingredients: [{ name: "milk", quantity: 1, unit: "cup" }],
            },
            {
              name: "Soup",
              baseServings: 2,
              servings: 2,
              ingredients: [{ name: "milk", quantity: 0.5, unit: "cup" }],
            },
          ],
        },
      }),
    );
  }

  async function change(plan: MealPlan, value: MealPlanChange) {
    return planOf(
      await client.callTool({
        name: "update_meal_plan",
        arguments: { planId: plan.id, expectedVersion: plan.version, change: value },
      }),
    );
  }

  it("resumes three meals, edits one, reviews quantities and makes one separately approved cart add", async () => {
    const original = await create();
    const ids = original.meals.map((meal) => meal.id);
    expect(new Set(ids).size).toBe(3);
    expect(await client.callTool({ name: "get_meal_plan", arguments: {} })).toMatchObject({
      structuredContent: { plans: [{ id: original.id, mealCount: 3 }] },
    });

    const resumed = planOf(
      await client.callTool({ name: "get_meal_plan", arguments: { planId: original.id } }),
    );

    expect(resumed).toEqual(original);
    const edited = await change(resumed, { type: "set_servings", mealId: ids[0], servings: 4 });
    expect(edited.meals.slice(1)).toEqual(original.meals.slice(1));
    const ingredients = aggregateMealPlan(edited).ingredients;
    expect(ingredients).toMatchObject([
      { name: "milk", requiredQuantity: 3.5 },
      { name: "eggs", requiredQuantity: 4 },
    ]);

    const search = await client.callTool({
      name: "search_products",
      arguments: { terms: ["milk"], storeId: edited.storeId },
    });

    const product = appPayloadSchemas.search_products.parse(search.structuredContent).results[0]
      .products[0];

    expect(product.upc).toBe("0001111041700");

    const milk = await change(edited, {
      type: "review_ingredient",
      key: ingredients[0].key,
      pantryQuantity: 1.5,
      choice: "buy",
      product: {
        upc: "0001111041700",
        productName: "Kroger 2% Reduced Fat Milk",
        packages: 1,
        price: 3.49,
      },
    });

    const ready = await change(milk, {
      type: "review_ingredient",
      key: ingredients[1].key,
      pantryQuantity: 4,
      choice: "pantry",
    });

    expect(aggregateMealPlan(ready).ready).toBe(true);
    expect(stub.cartPuts).toEqual([]);
    const args = { planId: ready.id, expectedVersion: ready.version };
    const prepared = planOf(await client.callTool({ name: "prepare_meal_plan", arguments: args }));
    expect(planOf(await client.callTool({ name: "prepare_meal_plan", arguments: args }))).toEqual(
      prepared,
    );
    const listId = prepared.shoppingListId;
    expect(listId).toEqual(expect.any(String));
    const list = await client.callTool({ name: "get_shopping_list", arguments: { listId } });
    expect(list).toMatchObject({
      structuredContent: {
        items: [{ upc: "0001111041700", quantity: 1 }],
        fulfillment: { storeId: DEFAULT_STORE_ID, modality: "DELIVERY" },
      },
    });
    const lists = await client.callTool({ name: "get_shopping_list", arguments: {} });
    expect(appPayloadSchemas.shopping_lists.parse(lists.structuredContent).lists).toHaveLength(1);
    expect(stub.cartPuts).toEqual([]);

    // Changing the preferred store cannot silently change this reviewed plan.
    await client.callTool({ name: "set_preferred_store", arguments: { storeId: "70500001" } });

    const rejectedAdds = await Promise.all(
      [{ modality: "PICKUP" }, { storeId: "70500001" }].map((conflicting) =>
        client.callTool({
          name: "add_shopping_list_to_cart",
          arguments: { listId, ...conflicting },
        }),
      ),
    );

    for (const rejected of rejectedAdds) {
      expect(rejected).toMatchObject({
        isError: true,
        structuredContent: { error: { code: "VALIDATION_ERROR" } },
      });
    }

    expect(stub.cartPuts).toEqual([]);

    const added = await client.callTool({
      name: "add_shopping_list_to_cart",
      arguments: { listId },
    });

    expect(added).toMatchObject({
      structuredContent: { outcome: "added", items: [{ modality: "DELIVERY", quantity: 1 }] },
    });
    expect(
      await client.callTool({ name: "add_shopping_list_to_cart", arguments: { listId } }),
    ).toMatchObject({ structuredContent: { outcome: "already_added" } });
    expect(stub.cartPuts).toHaveLength(1);
  });

  it("rejects incomplete, stale and invalid reviews without preparing or calling Kroger cart", async () => {
    const plan = await create();
    const args = { planId: plan.id, expectedVersion: plan.version };
    expect(await client.callTool({ name: "prepare_meal_plan", arguments: args })).toMatchObject({
      isError: true,
    });
    const key = aggregateMealPlan(plan).ingredients[0].key;

    const invalid = await client.callTool({
      name: "update_meal_plan",
      arguments: {
        ...args,
        change: { type: "review_ingredient", key, pantryQuantity: 100, choice: "pantry" },
      },
    });

    expect(invalid).toMatchObject({
      isError: true,
      structuredContent: { error: { code: "VALIDATION_ERROR" } },
    });

    const changed = await change(plan, {
      type: "set_servings",
      mealId: plan.meals[0].id,
      servings: 3,
    });

    expect(
      await client.callTool({
        name: "update_meal_plan",
        arguments: { ...args, change: { type: "remove_meal", mealId: plan.meals[1].id } },
      }),
    ).toMatchObject({ isError: true, structuredContent: { error: { code: "VALIDATION_ERROR" } } });
    expect(
      planOf(await client.callTool({ name: "get_meal_plan", arguments: { planId: plan.id } })),
    ).toEqual(changed);
    expect(stub.cartPuts).toEqual([]);
  });
});

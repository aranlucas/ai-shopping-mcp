import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolContext, UserStorage } from "../../src/tools/types.js";
import type { EquipmentItem, OrderRecord, PantryItem } from "../../src/utils/user-storage.js";

type AuthContext = {
  props?: {
    id: string;
    accessToken: string;
    tokenExpiresAt: number;
  };
};

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

type CapturedTool = {
  name: string;
  config: unknown;
  handler: ToolHandler;
};

const testState = vi.hoisted(() => ({
  authContext: undefined as AuthContext | undefined,
  capturedTools: [] as CapturedTool[],
}));

vi.mock("agents/mcp", () => ({
  getMcpAuthContext: () => testState.authContext,
}));

vi.mock("@modelcontextprotocol/ext-apps/server", () => ({
  registerAppTool: (_server: unknown, name: string, config: unknown, handler: ToolHandler) => {
    testState.capturedTools.push({ name, config, handler });
  },
}));

function authenticate(userId = "user-123") {
  testState.authContext = {
    props: {
      id: userId,
      accessToken: "test-token",
      tokenExpiresAt: Date.now() + 60_000,
    },
  };
}

function unauthenticate() {
  testState.authContext = undefined;
}

function textFromResult(result: unknown): string {
  const response = result as { content?: Array<{ type: string; text: string }> };
  return response.content?.[0]?.text ?? "";
}

function isErrorResult(result: unknown): boolean {
  return Boolean((result as { isError?: boolean }).isError);
}

function makeStorage(
  seed: {
    pantry?: PantryItem[];
    equipment?: EquipmentItem[];
    orders?: OrderRecord[];
  } = {},
): UserStorage {
  const pantryItems = seed.pantry ?? [];
  const equipmentItems = seed.equipment ?? [];
  const orders = seed.orders ?? [];

  return {
    pantry: {
      getAll: async () => pantryItems,
    },
    equipment: {
      getAll: async () => equipmentItems,
    },
    orderHistory: {
      getRecent: async (_userId: string, limit = 10) => orders.slice(0, limit),
    },
  } as unknown as UserStorage;
}

function makeContext(storage = makeStorage()): ToolContext {
  return {
    server: {} as unknown as ToolContext["server"],
    clients: {} as unknown as ToolContext["clients"],
    storage,
    getEnv: () => ({}) as Env,
    getSessionId: () => "session-1",
  };
}

function getCapturedHandler(name: string): ToolHandler {
  const tool = testState.capturedTools.find((captured) => captured.name === name);
  expect(tool).toBeDefined();
  return (
    tool?.handler ??
    (async () => {
      throw new Error(`Tool ${name} was not captured`);
    })
  );
}

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

describe("recipe tools", () => {
  beforeEach(() => {
    testState.capturedTools.length = 0;
    authenticate();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("search_recipes_from_web", () => {
    it("formats recipe results with ingredients and instructions", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({
            success: true,
            data: {
              results: [
                {
                  recipe: {
                    title: "Chocolate Chip Cookies",
                    description: "Classic chewy cookies",
                    cuisine: "American",
                    difficulty: "EASY",
                    totalTime: 30,
                    servings: "24 cookies",
                    slug: "chocolate-chip-cookies",
                    ingredients: [
                      { quantity: "2", unit: "cups", name: "flour" },
                      { name: "chocolate chips", notes: "semi-sweet" },
                    ],
                    instructions: [
                      { stepNumber: 1, instruction: "Mix dry ingredients" },
                      { stepNumber: 2, instruction: "Bake at 350F" },
                    ],
                  },
                },
              ],
            },
          }),
        ),
      );

      const { registerRecipeTools } = await import("../../src/tools/recipes.js");
      registerRecipeTools(makeContext());

      const result = await getCapturedHandler("search_recipes_from_web")({
        searchQuery: "cookies",
      });

      const text = textFromResult(result);
      expect(text).toContain("Chocolate Chip Cookies");
      expect(text).toContain("Classic chewy cookies");
      expect(text).toContain("American • easy • 30min total • 24 cookies");
      expect(text).toContain("2 cups flour");
      expect(text).toContain("chocolate chips (semi-sweet)");
      expect(text).toContain("1. Mix dry ingredients");
      expect(text).toContain("chocolate-chip-cookies");

      expect(result).toMatchObject({
        structuredContent: {
          _view: "search_recipes_from_web",
          searchQuery: "cookies",
        },
      });
    });

    it("falls back to cook time when total time is missing", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({
            success: true,
            data: {
              results: [
                {
                  recipe: {
                    title: "Quick Soup",
                    cookTime: 15,
                    slug: "quick-soup",
                  },
                },
              ],
            },
          }),
        ),
      );

      const { registerRecipeTools } = await import("../../src/tools/recipes.js");
      registerRecipeTools(makeContext());

      const result = await getCapturedHandler("search_recipes_from_web")({
        searchQuery: "soup",
      });

      expect(textFromResult(result)).toContain("15min cook");
    });

    it("returns a friendly message when there are no results", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ success: true, data: { results: [] } })),
      );

      const { registerRecipeTools } = await import("../../src/tools/recipes.js");
      registerRecipeTools(makeContext());

      const result = await getCapturedHandler("search_recipes_from_web")({
        searchQuery: "nonexistent",
      });

      expect(textFromResult(result)).toContain('No recipes found for "nonexistent"');
      expect(result).toMatchObject({
        structuredContent: { recipes: [] },
      });
    });

    it("returns an error when the API reports failure", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ success: false, error: { message: "rate limited" } })),
      );

      const { registerRecipeTools } = await import("../../src/tools/recipes.js");
      registerRecipeTools(makeContext());

      const result = await getCapturedHandler("search_recipes_from_web")({
        searchQuery: "anything",
      });

      expect(isErrorResult(result)).toBe(true);
      expect(textFromResult(result)).toContain("rate limited");
    });

    it("returns an error when the network request fails", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("connection refused");
        }),
      );

      const { registerRecipeTools } = await import("../../src/tools/recipes.js");
      registerRecipeTools(makeContext());

      const result = await getCapturedHandler("search_recipes_from_web")({
        searchQuery: "anything",
      });

      expect(isErrorResult(result)).toBe(true);
    });
  });

  describe("plan_meals", () => {
    it("returns guidance when the pantry is empty", async () => {
      const { registerRecipeTools } = await import("../../src/tools/recipes.js");
      registerRecipeTools(makeContext(makeStorage({ pantry: [] })));

      const result = await getCapturedHandler("plan_meals")({});

      expect(textFromResult(result)).toContain("Your pantry is empty");
    });

    it("builds a meal plan with expiring, expired, equipment, and order context", async () => {
      const storage = makeStorage({
        pantry: [
          {
            productName: "Spinach",
            quantity: 1,
            addedAt: isoDaysFromNow(-10),
            expiresAt: isoDaysFromNow(0.5),
          },
          {
            productName: "Chicken",
            quantity: 2,
            addedAt: isoDaysFromNow(-5),
            expiresAt: isoDaysFromNow(2.5),
          },
          {
            productName: "Rice",
            quantity: 1,
            addedAt: isoDaysFromNow(-30),
            expiresAt: isoDaysFromNow(30),
          },
          {
            productName: "Old Yogurt",
            quantity: 1,
            addedAt: isoDaysFromNow(-20),
            expiresAt: isoDaysFromNow(-3),
          },
          { productName: "Salt", quantity: 1, addedAt: isoDaysFromNow(-1) },
        ],
        equipment: [{ equipmentName: "Oven", category: "Cooking", addedAt: isoDaysFromNow(-1) }],
        orders: [
          {
            orderId: "o1",
            items: [
              { productId: "p1", productName: "Milk", quantity: 1 },
              { productId: "p2", productName: "Eggs", quantity: 1 },
            ],
            totalItems: 2,
            placedAt: isoDaysFromNow(-2),
          },
          {
            orderId: "o2",
            items: [{ productId: "p1", productName: "Milk", quantity: 1 }],
            totalItems: 1,
            placedAt: isoDaysFromNow(-1),
          },
        ],
      });

      const { registerRecipeTools } = await import("../../src/tools/recipes.js");
      registerRecipeTools(makeContext(storage));

      const result = await getCapturedHandler("plan_meals")({
        numberOfMeals: 2,
        mealType: "dinner",
        dietaryPreferences: "vegetarian",
        prioritizeExpiring: true,
      });

      const text = textFromResult(result);
      expect(text).toContain("**Meal Plan** (2 meals - dinner)");
      expect(text).toContain("1 expired item(s) excluded: Old Yogurt");
      expect(text).toContain("Dietary preferences: vegetarian");
      expect(text).toContain("Expiring Soon");
      expect(text).toContain("Spinach x1 (TODAY/TOMORROW)");
      expect(text).toContain("Chicken x2 (2-3 days)");
      expect(text).toContain("**Equipment (1 items):**");
      expect(text).toContain("Oven (Cooking)");
      expect(text).toContain("Frequently Purchased");
      expect(text).toContain("milk (ordered 2x)");
      expect(text).toContain("Prioritize using expiring items first");
    });

    it("handles items with no or invalid expiry dates", async () => {
      const storage = makeStorage({
        pantry: [
          { productName: "Flour", quantity: 1, addedAt: isoDaysFromNow(-1) },
          {
            productName: "Sugar",
            quantity: 1,
            addedAt: isoDaysFromNow(-1),
            expiresAt: "not-a-date",
          },
        ],
      });

      const { registerRecipeTools } = await import("../../src/tools/recipes.js");
      registerRecipeTools(makeContext(storage));

      const result = await getCapturedHandler("plan_meals")({
        numberOfMeals: 3,
        mealType: "any",
        prioritizeExpiring: false,
      });

      const text = textFromResult(result);
      expect(text).toContain("**Meal Plan** (3 meals)");
      expect(text).toContain("Flour x1");
      expect(text).toContain("Sugar x1");
    });

    it("throws when planning meals outside an authenticated request", async () => {
      unauthenticate();
      const { registerRecipeTools } = await import("../../src/tools/recipes.js");
      registerRecipeTools(makeContext());

      await expect(getCapturedHandler("plan_meals")({})).rejects.toThrow(
        "outside an authenticated MCP request",
      );
    });
  });
});

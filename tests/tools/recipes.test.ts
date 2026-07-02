import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolContext, UserStorage } from "../../src/tools/types.js";
import type { EquipmentItem, OrderRecord, PantryItem } from "../../src/utils/user-storage.js";

import { computeRestockSuggestions, registerRecipeTools } from "../../src/tools/recipes.js";

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
  config: { _meta?: { ui?: { resourceUri?: string } }; [key: string]: unknown };
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
  registerAppTool: (
    _server: unknown,
    name: string,
    config: CapturedTool["config"],
    handler: ToolHandler,
  ) => {
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
    /** When set, pantry.getAll rejects with this error. */
    pantryError?: Error;
  } = {},
): UserStorage {
  const pantryItems = seed.pantry ?? [];
  const equipmentItems = seed.equipment ?? [];
  const orders = seed.orders ?? [];
  const pantryError = seed.pantryError;

  return {
    pantry: {
      getAll: async () => {
        if (pantryError) throw pantryError;
        return pantryItems;
      },
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
    server: {
      registerTool: (name: string, config: CapturedTool["config"], handler: ToolHandler) => {
        testState.capturedTools.push({ name, config, handler });
      },
    } as unknown as ToolContext["server"],
    clients: {} as unknown as ToolContext["clients"],
    productService: {
      getProduct: () => {
        throw new Error("productService not used in this test");
      },
      enrichProductName: async () => null,
    } as unknown as ToolContext["productService"],
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

  describe("registration", () => {
    it("does not register the removed web recipe search tool", () => {
      registerRecipeTools(makeContext());

      expect(testState.capturedTools.map((tool) => tool.name)).toEqual([
        "get_meal_planning_context",
      ]);
    });

    it("registers meal planning context as text-only without app UI metadata", () => {
      registerRecipeTools(makeContext());

      expect(testState.capturedTools[0]?.config._meta?.ui?.resourceUri).toBeUndefined();
    });
  });

  describe("get_meal_planning_context", () => {
    it("returns guidance when the pantry is empty", async () => {
      registerRecipeTools(makeContext(makeStorage({ pantry: [] })));

      const result = await getCapturedHandler("get_meal_planning_context")({});

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
              { upc: "0000000000001", productName: "Milk", quantity: 1 },
              { upc: "0000000000002", productName: "Eggs", quantity: 1 },
            ],
            totalItems: 2,
            placedAt: isoDaysFromNow(-2),
          },
          {
            orderId: "o2",
            items: [{ upc: "0000000000001", productName: "Milk", quantity: 1 }],
            totalItems: 1,
            placedAt: isoDaysFromNow(-1),
          },
        ],
      });

      registerRecipeTools(makeContext(storage));

      const result = await getCapturedHandler("get_meal_planning_context")({
        numberOfMeals: 2,
        mealType: "dinner",
        dietaryPreferences: "vegetarian",
        prioritizeExpiring: true,
      });

      const text = textFromResult(result);
      expect((result as { structuredContent?: unknown }).structuredContent).toMatchObject({
        request: {
          numberOfMeals: 2,
          mealType: "dinner",
          dietaryPreferences: "vegetarian",
          prioritizeExpiring: true,
        },
      });
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

      registerRecipeTools(makeContext(storage));

      const result = await getCapturedHandler("get_meal_planning_context")({
        numberOfMeals: 3,
        mealType: "any",
        prioritizeExpiring: false,
      });

      const text = textFromResult(result);
      expect(text).toContain("**Meal Plan** (3 meals)");
      expect(text).toContain("Flour x1");
      expect(text).toContain("Sugar x1");
    });

    it("returns an isError response when pantry storage rejects", async () => {
      const storage = makeStorage({
        pantryError: new Error("KV unavailable"),
      });

      registerRecipeTools(makeContext(storage));

      const result = await getCapturedHandler("get_meal_planning_context")({});

      expect(isErrorResult(result)).toBe(true);
    });

    it("omits the 'Expiring Soon' section when prioritizeExpiring is false", async () => {
      const storage = makeStorage({
        pantry: [
          {
            productName: "Spinach",
            quantity: 1,
            addedAt: isoDaysFromNow(-1),
            expiresAt: isoDaysFromNow(1),
          },
          { productName: "Pasta", quantity: 2, addedAt: isoDaysFromNow(-1) },
        ],
      });

      registerRecipeTools(makeContext(storage));

      const result = await getCapturedHandler("get_meal_planning_context")({
        numberOfMeals: 2,
        mealType: "any",
        prioritizeExpiring: false,
      });

      const text = textFromResult(result);
      expect(isErrorResult(result)).toBe(false);
      expect(text).not.toContain("Expiring Soon");
      expect(text).toContain("Spinach x1");
    });

    it("uses singular 'meal' in the header when numberOfMeals is 1", async () => {
      const storage = makeStorage({
        pantry: [{ productName: "Pasta", quantity: 1, addedAt: isoDaysFromNow(-1) }],
      });

      registerRecipeTools(makeContext(storage));

      const result = await getCapturedHandler("get_meal_planning_context")({
        numberOfMeals: 1,
        mealType: "any",
      });

      const text = textFromResult(result);
      expect(text).toContain("**Meal Plan** (1 meal)");
      expect(text).not.toContain("1 meals");
    });

    it("throws when planning meals outside an authenticated request", async () => {
      unauthenticate();
      registerRecipeTools(makeContext());

      await expect(getCapturedHandler("get_meal_planning_context")({})).rejects.toThrow(
        "outside an authenticated MCP request",
      );
    });
  });

  describe("computeRestockSuggestions", () => {
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.parse("2026-07-02T00:00:00Z");

    function makeOrder(
      id: string,
      daysAgo: number,
      items: Array<{ productName: string; quantity?: number }>,
    ): OrderRecord {
      return {
        orderId: id,
        items: items.map((item, i) => ({
          upc: String(i + 1).padStart(13, "0"),
          productName: item.productName,
          quantity: item.quantity ?? 1,
        })),
        totalItems: items.length,
        placedAt: new Date(now - daysAgo * DAY).toISOString(),
      };
    }

    it("excludes items with fewer than 3 purchases", () => {
      const orders = [
        makeOrder("o1", 5, [{ productName: "Milk" }]),
        makeOrder("o2", 20, [{ productName: "Milk" }]),
      ];

      expect(computeRestockSuggestions(orders, now)).toEqual([]);
    });

    it("flags an item overdue relative to its median purchase interval (even interval count)", () => {
      // Purchased every 10 days, but the most recent purchase is 30 days
      // back — well past the median 10-day cadence.
      const orders = [
        makeOrder("o1", 50, [{ productName: "Milk" }]),
        makeOrder("o2", 40, [{ productName: "Milk" }]),
        makeOrder("o3", 30, [{ productName: "Milk" }]),
      ];

      expect(computeRestockSuggestions(orders, now)).toEqual([
        { name: "Milk", daysSinceLast: 30, medianIntervalDays: 10 },
      ]);
    });

    it("computes the median correctly for an odd number of intervals", () => {
      // 4 purchases -> 3 intervals: 20, 15, 20 days -> sorted [15, 20, 20] -> median 20.
      const orders = [
        makeOrder("o1", 80, [{ productName: "Eggs" }]),
        makeOrder("o2", 60, [{ productName: "Eggs" }]),
        makeOrder("o3", 45, [{ productName: "Eggs" }]),
        makeOrder("o4", 25, [{ productName: "Eggs" }]),
      ];

      expect(computeRestockSuggestions(orders, now)).toEqual([
        { name: "Eggs", daysSinceLast: 25, medianIntervalDays: 20 },
      ]);
    });

    it("excludes items that are not yet due", () => {
      // Purchased every ~10 days, and the last purchase was only 9 days ago.
      const orders = [
        makeOrder("o1", 29, [{ productName: "Bread" }]),
        makeOrder("o2", 19, [{ productName: "Bread" }]),
        makeOrder("o3", 9, [{ productName: "Bread" }]),
      ];

      expect(computeRestockSuggestions(orders, now)).toEqual([]);
    });

    it("groups purchases by case-insensitive product name", () => {
      const orders = [
        makeOrder("o1", 50, [{ productName: "milk" }]),
        makeOrder("o2", 40, [{ productName: "Milk" }]),
        makeOrder("o3", 30, [{ productName: "MILK" }]),
      ];

      const suggestions = computeRestockSuggestions(orders, now);
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]).toMatchObject({ daysSinceLast: 30, medianIntervalDays: 10 });
      expect(suggestions[0].name.toLowerCase()).toBe("milk");
    });

    it("caps suggestions at 5, sorted most-overdue first", () => {
      // Each product: bought every 10 days; "last" varies so overdue amount
      // (daysSinceLast - medianIntervalDays) is 5, 10, 15, 20, 25, 30.
      const lastDays = [15, 20, 25, 30, 35, 40];
      const orders = lastDays.flatMap((last, i) => {
        const name = `Product${i + 1}`;
        return [
          makeOrder(`${name}-o1`, last + 20, [{ productName: name }]),
          makeOrder(`${name}-o2`, last + 10, [{ productName: name }]),
          makeOrder(`${name}-o3`, last, [{ productName: name }]),
        ];
      });

      const suggestions = computeRestockSuggestions(orders, now);

      expect(suggestions).toHaveLength(5);
      expect(suggestions.map((s) => s.name)).toEqual([
        "Product6",
        "Product5",
        "Product4",
        "Product3",
        "Product2",
      ]);
    });

    it("ignores orders with an unparseable placedAt date", () => {
      const badOrder: OrderRecord = {
        orderId: "bad",
        items: [{ upc: "0000000000001", productName: "Milk", quantity: 1 }],
        totalItems: 1,
        placedAt: "not-a-date",
      };
      const orders = [
        badOrder,
        makeOrder("o1", 50, [{ productName: "Milk" }]),
        makeOrder("o2", 40, [{ productName: "Milk" }]),
        makeOrder("o3", 30, [{ productName: "Milk" }]),
      ];

      expect(computeRestockSuggestions(orders, now)).toEqual([
        { name: "Milk", daysSinceLast: 30, medianIntervalDays: 10 },
      ]);
    });
  });
});

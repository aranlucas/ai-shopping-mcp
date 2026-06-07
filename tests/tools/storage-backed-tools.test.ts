import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolContext, UserStorage } from "../../src/tools/types.js";
import type {
  EquipmentItem,
  OrderRecord,
  PantryItem,
  PreferredLocation,
  ShoppingListItem,
} from "../../src/utils/user-storage.js";

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

function makeStorage(overrides: Partial<UserStorage> = {}): UserStorage {
  const pantryItems: PantryItem[] = [];
  const equipmentItems: EquipmentItem[] = [];
  const orders: OrderRecord[] = [];
  const preferredLocations: PreferredLocation[] = [];
  const shoppingListItems: ShoppingListItem[] = [];

  const storage = {
    pantry: {
      add: async (_userId: string, item: PantryItem) => {
        pantryItems.push(item);
      },
      remove: async (_userId: string, productName: string) => {
        const index = pantryItems.findIndex((item) => item.productName === productName);
        if (index >= 0) {
          pantryItems.splice(index, 1);
        }
      },
      clear: async () => {
        pantryItems.length = 0;
      },
      getAll: async () => pantryItems,
    },
    equipment: {
      add: async (_userId: string, item: EquipmentItem) => {
        equipmentItems.push(item);
      },
      remove: async (_userId: string, equipmentName: string) => {
        const index = equipmentItems.findIndex((item) => item.equipmentName === equipmentName);
        if (index >= 0) {
          equipmentItems.splice(index, 1);
        }
      },
      clear: async () => {
        equipmentItems.length = 0;
      },
      getAll: async () => equipmentItems,
    },
    orderHistory: {
      add: async (_userId: string, order: OrderRecord) => {
        orders.push(order);
      },
      getAll: async () => orders,
    },
    shoppingList: {
      add: async (_userId: string, item: ShoppingListItem) => {
        shoppingListItems.push(item);
      },
      remove: async (_userId: string, productName: string) => {
        const index = shoppingListItems.findIndex((item) => item.productName === productName);
        if (index >= 0) {
          shoppingListItems.splice(index, 1);
        }
      },
      updateItem: async (
        _userId: string,
        productName: string,
        updates: Partial<Pick<ShoppingListItem, "checked" | "notes" | "quantity" | "upc">>,
      ) => {
        const item = shoppingListItems.find((candidate) => candidate.productName === productName);
        if (item) {
          Object.assign(item, updates);
        }
      },
      clear: async () => {
        shoppingListItems.length = 0;
      },
      getAll: async () => shoppingListItems,
      getUnchecked: async () => shoppingListItems.filter((item) => !item.checked),
    },
    preferredLocation: {
      set: async (_userId: string, location: PreferredLocation) => {
        preferredLocations.push(location);
      },
      get: async () => preferredLocations.at(-1) ?? null,
    },
  };

  return { ...storage, ...overrides } as unknown as UserStorage;
}

function makeContext(storage = makeStorage()): ToolContext {
  return {
    server: {
      server: {
        elicitInput: async () => ({ action: "accept", content: { confirm: true } }),
      },
    } as unknown as ToolContext["server"],
    clients: {
      cartClient: {
        PUT: async () => ({
          data: undefined,
          response: new Response(null, { status: 204 }),
        }),
      },
    } as unknown as ToolContext["clients"],
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

describe("storage-backed tools", () => {
  beforeEach(() => {
    testState.capturedTools.length = 0;
    authenticate();
  });

  it("adds pantry items and returns structured view content", async () => {
    const { registerPantryTools } = await import("../../src/tools/pantry.js");
    registerPantryTools(makeContext());

    const result = await getCapturedHandler("manage_pantry")({
      action: "add",
      items: [{ productName: "Milk" }],
    });

    expect(textFromResult(result)).toContain("Added 1 item(s) to pantry");
    expect(result).toMatchObject({
      structuredContent: {
        _view: "manage_pantry",
        actionDetail: "Added 1 item(s)",
        items: [
          {
            productName: "Milk",
            quantity: 1,
          },
        ],
      },
    });
  });

  it("rejects pantry add without items before touching storage", async () => {
    const { registerPantryTools } = await import("../../src/tools/pantry.js");
    registerPantryTools(makeContext());

    const result = await getCapturedHandler("manage_pantry")({ action: "add" });

    expect(isErrorResult(result)).toBe(true);
    expect(textFromResult(result)).toContain("'items' array is required");
  });

  it("removes and clears pantry items", async () => {
    const storage = makeStorage();
    const { registerPantryTools } = await import("../../src/tools/pantry.js");
    registerPantryTools(makeContext(storage));
    const handler = getCapturedHandler("manage_pantry");

    await handler({
      action: "add",
      items: [{ productName: "Eggs" }, { productName: "Bread", quantity: 2 }],
    });

    const removeResult = await handler({
      action: "remove",
      items: [{ productName: "Eggs" }],
    });
    expect(textFromResult(removeResult)).toContain("Removed 1 item(s) from pantry");
    expect(removeResult).toMatchObject({
      structuredContent: {
        items: [{ productName: "Bread", quantity: 2 }],
      },
    });

    const clearResult = await handler({ action: "clear" });
    expect(clearResult).toMatchObject({
      structuredContent: {
        actionDetail: "Pantry cleared",
        items: [],
      },
    });
  });

  it("throws when pantry is used outside an authenticated request", async () => {
    unauthenticate();
    const { registerPantryTools } = await import("../../src/tools/pantry.js");
    registerPantryTools(makeContext());

    await expect(getCapturedHandler("manage_pantry")({ action: "clear" })).rejects.toThrow(
      "outside an authenticated MCP request",
    );
  });

  it("adds, removes, and clears kitchen equipment", async () => {
    const { registerEquipmentTools } = await import("../../src/tools/equipment.js");
    registerEquipmentTools(makeContext());
    const handler = getCapturedHandler("manage_equipment");

    const addResult = await handler({
      action: "add",
      items: [{ equipmentName: "Dutch oven", category: "Cooking" }],
    });
    expect(textFromResult(addResult)).toContain("Added 1 item(s) to equipment");
    expect(textFromResult(addResult)).toContain("Dutch oven");

    const removeResult = await handler({
      action: "remove",
      equipmentName: "Dutch oven",
    });
    expect(textFromResult(removeResult)).toContain("Item removed from equipment");

    const clearResult = await handler({ action: "clear" });
    expect(textFromResult(clearResult)).toBe("Equipment cleared successfully.");
  });

  it("validates equipment mutation arguments", async () => {
    const { registerEquipmentTools } = await import("../../src/tools/equipment.js");
    registerEquipmentTools(makeContext());
    const handler = getCapturedHandler("manage_equipment");

    const addResult = await handler({ action: "add" });
    const removeResult = await handler({ action: "remove" });

    expect(isErrorResult(addResult)).toBe(true);
    expect(textFromResult(addResult)).toContain("'items' array is required");
    expect(isErrorResult(removeResult)).toBe(true);
    expect(textFromResult(removeResult)).toContain("'equipmentName' is required");
  });

  it("records order totals and optional metadata", async () => {
    const storedOrders: OrderRecord[] = [];
    const storage = makeStorage({
      orderHistory: {
        add: async (_userId: string, order: OrderRecord) => {
          storedOrders.push(order);
        },
        getAll: async () => storedOrders,
      } as unknown as UserStorage["orderHistory"],
    });
    const { registerOrderTools } = await import("../../src/tools/orders.js");
    registerOrderTools(makeContext(storage));

    const result = await getCapturedHandler("mark_order_placed")({
      items: [
        { productId: "0000000000001", productName: "Apples", quantity: 2, price: 1.5 },
        { productId: "0000000000002", productName: "Bananas", quantity: 3 },
      ],
      locationId: "70500847",
      notes: "Pickup order",
    });

    expect(textFromResult(result)).toContain("Order recorded successfully");
    expect(storedOrders).toHaveLength(1);
    expect(storedOrders[0]).toMatchObject({
      totalItems: 5,
      estimatedTotal: 3,
      locationId: "70500847",
      notes: "Pickup order",
    });
    expect(storedOrders[0]?.orderId).toMatch(/^ORD-/);
  });

  it("adds, updates, removes, and clears shopping list items", async () => {
    const { registerShoppingListTools } = await import("../../src/tools/shopping-list.js");
    registerShoppingListTools(makeContext());
    const handler = getCapturedHandler("manage_shopping_list");

    const addResult = await handler({
      action: "add",
      items: [
        {
          productName: "Milk",
          upc: "0000000000001",
          quantity: 1,
          notes: "whole",
        },
        {
          productName: "Eggs",
          quantity: 2,
        },
      ],
    });

    expect(textFromResult(addResult)).toContain("Added 2 item(s) to shopping list");
    expect(addResult).toMatchObject({
      structuredContent: {
        _view: "manage_shopping_list",
        actionDetail: "Added 2 item(s)",
      },
    });

    const updateResult = await handler({
      action: "update",
      productName: "Eggs",
      quantity: 3,
      upc: "0000000000002",
      notes: "large",
    });
    expect(updateResult).toMatchObject({
      structuredContent: {
        actionDetail: 'Updated "Eggs"',
        items: [
          { productName: "Milk", quantity: 1 },
          {
            productName: "Eggs",
            quantity: 3,
            upc: "0000000000002",
            notes: "large",
          },
        ],
      },
    });

    const removeResult = await handler({
      action: "remove",
      productName: "Milk",
    });
    expect(textFromResult(removeResult)).toContain('Removed "Milk" from shopping list');

    const clearResult = await handler({ action: "clear" });
    expect(clearResult).toMatchObject({
      structuredContent: {
        actionDetail: "List cleared",
        items: [],
      },
    });
  });

  it("validates shopping list mutation arguments", async () => {
    const { registerShoppingListTools } = await import("../../src/tools/shopping-list.js");
    registerShoppingListTools(makeContext());
    const handler = getCapturedHandler("manage_shopping_list");

    const addResult = await handler({ action: "add" });
    const removeResult = await handler({ action: "remove" });
    const updateResult = await handler({ action: "update" });

    expect(isErrorResult(addResult)).toBe(true);
    expect(textFromResult(addResult)).toContain("'items' array is required");
    expect(isErrorResult(removeResult)).toBe(true);
    expect(textFromResult(removeResult)).toContain("'productName' is required");
    expect(isErrorResult(updateResult)).toBe(true);
    expect(textFromResult(updateResult)).toContain("'productName' is required");
  });

  it("checks out UPC-backed shopping list items and reports items missing UPCs", async () => {
    const putCalls: unknown[] = [];
    const storage = makeStorage({
      preferredLocation: {
        get: async () => ({
          locationId: "70500847",
          locationName: "QFC Broadway",
          address: "500 Broadway E",
          chain: "QFC",
        }),
      } as unknown as UserStorage["preferredLocation"],
    });
    const context = makeContext(storage);
    context.clients = {
      cartClient: {
        PUT: async (_path: string, request: unknown) => {
          putCalls.push(request);
          return {
            data: undefined,
            response: new Response(null, { status: 204 }),
          };
        },
      },
    } as unknown as ToolContext["clients"];

    const { registerShoppingListTools } = await import("../../src/tools/shopping-list.js");
    registerShoppingListTools(context);
    const manageHandler = getCapturedHandler("manage_shopping_list");
    const checkoutHandler = getCapturedHandler("checkout_shopping_list");

    await manageHandler({
      action: "add",
      items: [
        { productName: "Apples", upc: "0000000000001", quantity: 2 },
        { productName: "Bananas", quantity: 3 },
      ],
    });

    const result = await checkoutHandler({ modality: "PICKUP" });

    expect(textFromResult(result)).toContain("Added 1 item(s) to cart at QFC Broadway");
    expect(textFromResult(result)).toContain("1 item(s) need a UPC before checkout");
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0]).toMatchObject({
      body: {
        items: [{ upc: "0000000000001", quantity: 2, modality: "PICKUP" }],
      },
    });
    expect(result).toMatchObject({
      structuredContent: {
        actionDetail: "Checkout complete: 1 item(s) added to cart",
        items: [
          { productName: "Apples", checked: true },
          { productName: "Bananas", checked: false },
        ],
      },
    });
  });

  it("returns a checkout message when there are no unchecked shopping list items", async () => {
    const { registerShoppingListTools } = await import("../../src/tools/shopping-list.js");
    registerShoppingListTools(makeContext());

    const result = await getCapturedHandler("checkout_shopping_list")({ modality: "PICKUP" });

    expect(textFromResult(result)).toBe("No unchecked items on your shopping list to checkout.");
  });

  it("searches locations with query filters and returns structured locations", async () => {
    const getCalls: unknown[] = [];
    const location = {
      locationId: "70500847",
      name: "QFC Broadway",
      chain: "QFC",
      address: {
        addressLine1: "500 Broadway E",
        city: "Seattle",
        state: "WA",
        zipCode: "98102",
      },
    };
    const context = makeContext();
    context.clients = {
      locationClient: {
        GET: async (_path: string, request: unknown) => {
          getCalls.push(request);
          return {
            data: { data: [location] },
            response: new Response(null, { status: 200 }),
          };
        },
      },
    } as unknown as ToolContext["clients"];
    const { registerLocationTools } = await import("../../src/tools/location.js");
    registerLocationTools(context);

    const result = await getCapturedHandler("search_locations")({
      zipCodeNear: "98122",
      limit: 3,
      chain: "QFC",
    });

    expect(textFromResult(result)).toContain("Found 1 location(s)");
    expect(result).toMatchObject({
      structuredContent: {
        _view: "search_locations",
        locations: [{ locationId: "70500847", name: "QFC Broadway" }],
      },
    });
    expect(getCalls[0]).toMatchObject({
      params: {
        query: {
          "filter.zipCode.near": "98122",
          "filter.limit": 3,
          "filter.chain": "QFC",
        },
      },
    });
  });

  it("returns an error when location details are missing", async () => {
    const context = makeContext();
    context.clients = {
      locationClient: {
        GET: async () => ({
          data: {},
          response: new Response(null, { status: 200 }),
        }),
      },
    } as unknown as ToolContext["clients"];
    const { registerLocationTools } = await import("../../src/tools/location.js");
    registerLocationTools(context);

    const result = await getCapturedHandler("get_location_details")({
      locationId: "70500847",
    });

    expect(isErrorResult(result)).toBe(true);
    expect(textFromResult(result)).toContain("No information found for location ID: 70500847");
  });

  it("saves preferred location details for the authenticated user", async () => {
    const savedLocations: PreferredLocation[] = [];
    const context = makeContext(
      makeStorage({
        preferredLocation: {
          set: async (_userId: string, location: PreferredLocation) => {
            savedLocations.push(location);
          },
          get: async () => savedLocations.at(-1) ?? null,
        } as unknown as UserStorage["preferredLocation"],
      }),
    );
    context.clients = {
      locationClient: {
        GET: async () => ({
          data: {
            data: {
              locationId: "70500847",
              name: "QFC Broadway",
              chain: "QFC",
              address: {
                addressLine1: "500 Broadway E",
                city: "Seattle",
                state: "WA",
                zipCode: "98102",
              },
            },
          },
          response: new Response(null, { status: 200 }),
        }),
      },
    } as unknown as ToolContext["clients"];
    const { registerLocationTools } = await import("../../src/tools/location.js");
    registerLocationTools(context);

    const result = await getCapturedHandler("set_preferred_location")({
      locationId: "70500847",
    });

    expect(textFromResult(result)).toContain("Preferred location set successfully");
    expect(savedLocations).toMatchObject([
      {
        locationId: "70500847",
        locationName: "QFC Broadway",
        address: "500 Broadway E, Seattle, WA 98102",
        chain: "QFC",
      },
    ]);
  });
});

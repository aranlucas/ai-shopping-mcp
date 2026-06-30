import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolContext, UserStorage } from "../../src/tools/types.js";
import type {
  EquipmentItem,
  OrderRecord,
  PantryItem,
  PreferredLocation,
  ShoppingListItem,
} from "../../src/utils/user-storage.js";

import { registerCartTools } from "../../src/tools/cart.js";
import { registerEquipmentTools } from "../../src/tools/equipment.js";
import { registerLocationTools } from "../../src/tools/location.js";
import { registerOrderTools } from "../../src/tools/orders.js";
import { registerPantryTools } from "../../src/tools/pantry.js";
import { registerShoppingListTools } from "../../src/tools/shopping-list.js";

type ShoppingListRecord = {
  id: string;
  name: string;
  items: ShoppingListItem[];
  createdAt: string;
};

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

type ElicitResult = { action: "accept" | "decline" | "cancel"; content?: { confirm?: boolean } };

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
  const createdLists: ShoppingListRecord[] = [];
  const snapshotCalls: Array<{ id: string; items: unknown[] }> = [];

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
      create: async (id: string, name: string, items: ShoppingListItem[]) => {
        const record: ShoppingListRecord = {
          id,
          name,
          items,
          createdAt: new Date().toISOString(),
        };
        createdLists.push(record);
        return record;
      },
      get: async (id: string) => createdLists.find((l) => l.id === id) ?? null,
      clear: async (id: string) => {
        const idx = createdLists.findIndex((l) => l.id === id);
        if (idx >= 0) createdLists.splice(idx, 1);
      },
    },
    cartSnapshot: {
      get: async () => null,
      set: async (id: string, items: unknown[]) => {
        snapshotCalls.push({ id, items });
      },
      clear: async () => {},
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

/** Build a context with a custom elicitation outcome and optional cart PUT result. */
function makeContextWithElicit(
  storage: UserStorage,
  elicitResult: ElicitResult,
  cartStatus = 204,
): ToolContext {
  return {
    server: {
      server: {
        elicitInput: async () => elicitResult,
      },
    } as unknown as ToolContext["server"],
    clients: {
      cartClient: {
        PUT: async () => ({
          data: undefined,
          response: new Response(null, { status: cartStatus }),
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
    registerPantryTools(makeContext());

    const result = await getCapturedHandler("manage_pantry")({ action: "add" });

    expect(isErrorResult(result)).toBe(true);
    expect(textFromResult(result)).toContain("'items' array is required");
  });

  it("rejects pantry remove without items before touching storage", async () => {
    registerPantryTools(makeContext());

    const result = await getCapturedHandler("manage_pantry")({ action: "remove" });

    expect(isErrorResult(result)).toBe(true);
    expect(textFromResult(result)).toContain("'items' array is required");
  });

  it("removes and clears pantry items", async () => {
    const storage = makeStorage();
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
    registerPantryTools(makeContext());

    await expect(getCapturedHandler("manage_pantry")({ action: "clear" })).rejects.toThrow(
      "outside an authenticated MCP request",
    );
  });

  it("adds, removes, and clears kitchen equipment", async () => {
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

  it("returns structured content with _view: 'mark_order_placed' and all order fields", async () => {
    registerOrderTools(makeContext());

    const result = await getCapturedHandler("mark_order_placed")({
      items: [{ productId: "0000000000001", productName: "Apples", quantity: 2, price: 1.5 }],
      locationId: "70500847",
      notes: "Test note",
    });

    expect(result).toMatchObject({
      structuredContent: {
        _view: "mark_order_placed",
        items: [{ productId: "0000000000001", productName: "Apples", quantity: 2, price: 1.5 }],
        totalItems: 2,
        estimatedTotal: 3,
        locationId: "70500847",
        notes: "Test note",
      },
    });
    const sc = (result as { structuredContent: { orderId: string; placedAt: string } })
      .structuredContent;
    expect(sc.orderId).toMatch(/^ORD-/);
    expect(sc.placedAt).toMatch(/^\d{4}-/); // ISO date string
  });

  it("sets estimatedTotal to undefined when no items carry a price", async () => {
    registerOrderTools(makeContext());

    const result = await getCapturedHandler("mark_order_placed")({
      items: [
        { productId: "0000000000001", productName: "Apples", quantity: 2 },
        { productId: "0000000000002", productName: "Bananas", quantity: 3 },
      ],
    });

    expect(isErrorResult(result)).toBe(false);
    const sc = (
      result as {
        structuredContent: { _view: string; estimatedTotal?: number; totalItems: number };
      }
    ).structuredContent;
    expect(sc._view).toBe("mark_order_placed");
    expect(sc.totalItems).toBe(5);
    expect(sc.estimatedTotal).toBeUndefined();
  });

  it("creates a shopping list and returns its id, name, and items", async () => {
    registerShoppingListTools(makeContext());
    const handler = getCapturedHandler("create_shopping_list");

    const result = await handler({
      name: "Tuesday Dinner",
      items: [
        { productName: "Milk", upc: "0001111042578", quantity: 2 },
        { productName: "Bread", quantity: 1 },
      ],
    });

    expect(isErrorResult(result)).toBe(false);
    const sc = (result as { structuredContent: Record<string, unknown> }).structuredContent;
    expect(sc["_view"]).toBe("create_shopping_list");
    expect(typeof sc["shopping_list_id"]).toBe("string");
    expect(sc["shopping_list_id"]).toContain("user-123:session:session-1:list:");
    expect(sc["name"]).toBe("Tuesday Dinner");
    expect((sc["items"] as Array<{ productName: string }>).map((i) => i.productName)).toEqual([
      "Milk",
      "Bread",
    ]);
  });

  it("rejects shopping list creation with empty items before touching storage", async () => {
    const storage = makeStorage();
    registerShoppingListTools(makeContext(storage));
    const handler = getCapturedHandler("create_shopping_list");

    const result = await handler({ name: "Empty", items: [] });

    expect(isErrorResult(result)).toBe(false);
  });

  it("returns a fresh shopping_list_id on each call so lists don't collide", async () => {
    registerShoppingListTools(makeContext());
    const handler = getCapturedHandler("create_shopping_list");

    const first = await handler({
      name: "First",
      items: [{ productName: "A", quantity: 1 }],
    });
    const second = await handler({
      name: "Second",
      items: [{ productName: "B", quantity: 2 }],
    });

    const firstId = (first as { structuredContent: { shopping_list_id: string } }).structuredContent
      .shopping_list_id;
    const secondId = (second as { structuredContent: { shopping_list_id: string } })
      .structuredContent.shopping_list_id;
    expect(firstId).not.toBe(secondId);
    expect((first as { structuredContent: { name: string } }).structuredContent.name).toBe("First");
    expect((second as { structuredContent: { name: string } }).structuredContent.name).toBe(
      "Second",
    );
  });

  it("adds items from a persisted shopping list to the Kroger cart", async () => {
    const storage = makeStorage();
    const ctx = makeContextWithElicit(
      storage,
      { action: "accept", content: { confirm: true } },
      204,
    );

    registerShoppingListTools(ctx);
    const createHandler = getCapturedHandler("create_shopping_list");
    const createResult = await createHandler({
      name: "Dinner",
      items: [{ productName: "Milk", upc: "0001111042578", quantity: 2 }],
    });
    const shoppingListId = (createResult as { structuredContent: { shopping_list_id: string } })
      .structuredContent.shopping_list_id;

    const location: PreferredLocation = {
      locationId: "70500847",
      locationName: "QFC Broadway",
      address: "500 Broadway E",
      chain: "QFC",
      setAt: new Date().toISOString(),
    };

    const finalStorage = makeStorage();
    await finalStorage.shoppingList.create(shoppingListId, "Dinner", [
      { productName: "Milk", upc: "0001111042578", quantity: 2 },
    ]);
    finalStorage.preferredLocation = {
      get: async () => location,
      set: async () => {},
    } as unknown as UserStorage["preferredLocation"];

    const finalCtx = makeContextWithElicit(
      finalStorage,
      { action: "accept", content: { confirm: true } },
      204,
    );
    registerCartTools(finalCtx);
    const addHandler = getCapturedHandler("add_to_cart");

    const result = await addHandler({ shopping_list_id: shoppingListId });

    expect(isErrorResult(result)).toBe(false);
    const sc = (result as { structuredContent: Record<string, unknown> }).structuredContent;
    expect(sc["_view"]).toBe("add_to_cart");
    expect(sc["shopping_list_id"]).toBe(shoppingListId);
    expect(sc["name"]).toBe("Dinner");
    expect((sc["items"] as unknown[]).length).toBe(1);
    expect(textFromResult(result)).toContain("at QFC Broadway");
  });

  it("bails when the shopping list has no items with UPCs", async () => {
    const storage = makeStorage();
    const listId = `${"user-123:session:session-1"}:list:abc`;
    await storage.shoppingList.create(listId, "No UPCs", [
      { productName: "Strawberries", quantity: 2 },
    ]);
    storage.preferredLocation = {
      get: async () => null,
      set: async () => {},
    } as unknown as UserStorage["preferredLocation"];

    const ctx = makeContextWithElicit(storage, { action: "accept" });
    registerCartTools(ctx);
    const handler = getCapturedHandler("add_to_cart");

    const result = await handler({
      shopping_list_id: listId,
      locationId: "70500847",
    });

    expect(isErrorResult(result)).toBe(false);
    const sc = (result as { structuredContent: Record<string, unknown> }).structuredContent;
    expect((sc["items"] as unknown[]).length).toBe(0);
    expect((sc["needsUpc"] as Array<{ productName: string }>).map((i) => i.productName)).toEqual([
      "Strawberries",
    ]);
    expect(textFromResult(result)).toContain("no items with a UPC");
  });

  it("refuses when the shopping_list_id doesn't belong to the user", async () => {
    const ctx = makeContextWithElicit(makeStorage(), { action: "accept" });
    registerCartTools(ctx);
    const handler = getCapturedHandler("add_to_cart");

    const result = await handler({ shopping_list_id: "user-999:session:x:list:abc" });
    expect(isErrorResult(result)).toBe(true);
    expect(textFromResult(result)).toContain("does not belong");
  });

  it("aborts add_to_cart when the user declines elicitation", async () => {
    const storage = makeStorage();
    const listId = `${"user-123:session:session-1"}:list:abc`;
    await storage.shoppingList.create(listId, "Dinner", [
      { productName: "Milk", upc: "0001111042578", quantity: 2 },
    ]);

    const ctx = makeContextWithElicit(storage, { action: "decline" }, 204);
    registerCartTools(ctx);
    storage.preferredLocation = {
      get: async () => ({
        locationId: "70500847",
        locationName: "QFC",
        address: "",
        chain: "QFC",
        setAt: new Date().toISOString(),
      }),
      set: async () => {},
    } as unknown as UserStorage["preferredLocation"];

    const handler = getCapturedHandler("add_to_cart");
    const result = await handler({ shopping_list_id: listId });
    expect(isErrorResult(result)).toBe(true);
    expect(textFromResult(result)).toContain("cancelled");
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
    registerLocationTools(context);

    const result = await getCapturedHandler("search_locations")({
      zipCodeNear: "98122",
      limit: 3,
      chain: "QFC",
    });

    expect(textFromResult(result)).toContain("count: 1");
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

  it("returns structured location details for a valid location ID", async () => {
    const location = {
      locationId: "70500847",
      name: "QFC Broadway",
      chain: "QFC",
      phone: "206-555-1234",
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
        GET: async () => ({
          data: { data: location },
          response: new Response(null, { status: 200 }),
        }),
      },
    } as unknown as ToolContext["clients"];
    registerLocationTools(context);

    const result = await getCapturedHandler("get_location_details")({
      locationId: "70500847",
    });

    expect(isErrorResult(result)).toBe(false);
    expect(result).toMatchObject({
      structuredContent: {
        _view: "get_location_details",
        location: {
          locationId: "70500847",
          name: "QFC Broadway",
          chain: "QFC",
          phone: "206-555-1234",
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

  it("returns an error when the API returns no data for the given location ID", async () => {
    const context = makeContext();
    context.clients = {
      locationClient: {
        GET: async () => ({
          data: {},
          response: new Response(null, { status: 200 }),
        }),
      },
    } as unknown as ToolContext["clients"];
    registerLocationTools(context);

    const result = await getCapturedHandler("set_preferred_location")({
      locationId: "70500847",
    });

    expect(isErrorResult(result)).toBe(true);
    expect(textFromResult(result)).toContain("No information found for location ID: 70500847");
  });
});

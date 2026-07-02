import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolContext, UserStorage } from "../../src/tools/types.js";
import type {
  CartSnapshotItem,
  EquipmentItem,
  OrderRecord,
  PantryItem,
  PreferredLocation,
  ShoppingListItem,
} from "../../src/utils/user-storage.js";

import { registerCartTools } from "../../src/tools/cart.js";
import { registerInventoryTools } from "../../src/tools/inventory.js";
import { registerLocationTools } from "../../src/tools/location.js";
import { registerOrderTools } from "../../src/tools/orders.js";
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
  const snapshots = new Map<string, CartSnapshotItem[]>();

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
      getRecent: async (_userId: string, limit = 10) => orders.slice(0, limit),
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
      get: async (id: string) => snapshots.get(id) ?? null,
      set: async (id: string, items: CartSnapshotItem[]) => {
        snapshots.set(id, items);
      },
      clear: async (id: string) => {
        snapshots.delete(id);
      },
    },
    cartMirror: {
      getAll: async () => [],
      append: async (_userId: string, items: CartSnapshotItem[], addedAt: string) =>
        items.map((item) => ({ ...item, addedAt })),
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
      registerTool: (name: string, config: unknown, handler: ToolHandler) => {
        testState.capturedTools.push({ name, config, handler });
      },
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
      registerTool: (name: string, config: unknown, handler: ToolHandler) => {
        testState.capturedTools.push({ name, config, handler });
      },
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

function getCapturedTool(name: string): CapturedTool {
  const tool = testState.capturedTools.find((captured) => captured.name === name);
  expect(tool).toBeDefined();
  return tool as CapturedTool;
}

describe("storage-backed tools", () => {
  beforeEach(() => {
    testState.capturedTools.length = 0;
    authenticate();
  });

  it("adds pantry items and returns structured view content", async () => {
    registerInventoryTools(makeContext());

    const result = await getCapturedHandler("add_to_inventory")({
      inventory: "pantry",
      items: [{ name: "Milk" }],
    });

    expect(textFromResult(result)).toContain("Added 1 item(s) to pantry");
    expect(result).toMatchObject({
      structuredContent: {
        _view: "pantry",
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

  it("rejects remove_from_inventory without items or all", async () => {
    registerInventoryTools(makeContext());

    const result = await getCapturedHandler("remove_from_inventory")({ inventory: "pantry" });

    expect(isErrorResult(result)).toBe(true);
    expect(textFromResult(result)).toContain("Provide items to remove");
  });

  it("removes and clears pantry items", async () => {
    const storage = makeStorage();
    registerInventoryTools(makeContext(storage));
    const addHandler = getCapturedHandler("add_to_inventory");
    const removeHandler = getCapturedHandler("remove_from_inventory");

    await addHandler({
      inventory: "pantry",
      items: [{ name: "Eggs" }, { name: "Bread", quantity: 2 }],
    });

    const removeResult = await removeHandler({
      inventory: "pantry",
      items: [{ name: "Eggs" }],
    });
    expect(textFromResult(removeResult)).toContain("Removed 1 item(s) from pantry");
    expect(removeResult).toMatchObject({
      structuredContent: {
        items: [{ productName: "Bread", quantity: 2 }],
      },
    });

    const clearResult = await removeHandler({ inventory: "pantry", all: true });
    expect(clearResult).toMatchObject({
      structuredContent: {
        _view: "pantry",
        actionDetail: "Pantry cleared",
        items: [],
      },
    });
  });

  it("throws when inventory tools are used outside an authenticated request", async () => {
    unauthenticate();
    registerInventoryTools(makeContext());

    await expect(
      getCapturedHandler("remove_from_inventory")({ inventory: "pantry", all: true }),
    ).rejects.toThrow("outside an authenticated MCP request");
  });

  it("adds, removes, and clears kitchen equipment", async () => {
    registerInventoryTools(makeContext());
    const addHandler = getCapturedHandler("add_to_inventory");
    const removeHandler = getCapturedHandler("remove_from_inventory");

    const addResult = await addHandler({
      inventory: "equipment",
      items: [{ name: "Dutch oven", category: "Cooking" }],
    });
    expect(textFromResult(addResult)).toContain("Added 1 item(s) to equipment");
    expect(addResult).toMatchObject({
      structuredContent: {
        _view: "kitchen_equipment",
        actionDetail: "Added 1 item(s)",
        items: [{ equipmentName: "Dutch oven", category: "Cooking" }],
      },
    });

    const removeResult = await removeHandler({
      inventory: "equipment",
      items: [{ name: "Dutch oven" }],
    });
    expect(textFromResult(removeResult)).toContain("Removed 1 item(s) from equipment");
    expect(removeResult).toMatchObject({
      structuredContent: {
        _view: "kitchen_equipment",
        actionDetail: "Removed 1 item(s)",
        items: [],
      },
    });

    const clearResult = await removeHandler({ inventory: "equipment", all: true });
    expect(textFromResult(clearResult)).toBe("Equipment cleared successfully.");
    expect(clearResult).toMatchObject({
      structuredContent: {
        _view: "kitchen_equipment",
        actionDetail: "Kitchen equipment cleared",
        items: [],
      },
    });
  });

  it("validates add_to_inventory arguments", async () => {
    registerInventoryTools(makeContext());

    const addResult = await getCapturedHandler("add_to_inventory")({
      inventory: "pantry",
      items: [],
    });

    expect(isErrorResult(addResult)).toBe(true);
  });

  describe("get_shopping_profile", () => {
    it("reports 'none set' guidance when no preferred store is set", async () => {
      registerInventoryTools(makeContext());

      const result = await getCapturedHandler("get_shopping_profile")({});

      expect(isErrorResult(result)).toBe(false);
      const text = textFromResult(result);
      expect(text).toContain("none set — use search_stores + set_preferred_store");
      expect(text).toContain("## Pantry");
      expect(text).toContain("empty");
      expect(text).toContain("## Kitchen equipment");
      expect(text).toContain("none");
      expect(text).toContain("## Frequently purchased");
      expect(text).toContain("no order history yet");
    });

    it("summarizes preferred store, pantry with expiring flags, equipment, and frequently purchased items", async () => {
      const soon = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const storage = makeStorage({
        preferredLocation: {
          get: async () => ({
            locationId: "70500034",
            locationName: "QFC Broadway",
            address: "417 Broadway E",
            chain: "QFC",
            setAt: new Date().toISOString(),
          }),
          set: async () => {},
        } as unknown as UserStorage["preferredLocation"],
        pantry: {
          getAll: async () => [
            {
              productName: "Milk",
              quantity: 1,
              addedAt: new Date().toISOString(),
              expiresAt: soon,
            },
            { productName: "Rice", quantity: 2, addedAt: new Date().toISOString() },
          ],
        } as unknown as UserStorage["pantry"],
        equipment: {
          getAll: async () => [{ equipmentName: "Dutch oven", category: "Cooking", addedAt: "" }],
        } as unknown as UserStorage["equipment"],
        orderHistory: {
          getRecent: async () => [
            {
              orderId: "o1",
              items: [{ productId: "p1", productName: "Milk", quantity: 1 }],
              totalItems: 1,
              placedAt: new Date().toISOString(),
            },
          ],
        } as unknown as UserStorage["orderHistory"],
      });
      registerInventoryTools(makeContext(storage));

      const result = await getCapturedHandler("get_shopping_profile")({});

      const text = textFromResult(result);
      expect(text).toContain("QFC Broadway");
      expect(text).toContain("Milk x1 (expiring soon)");
      expect(text).toContain("Rice x2");
      expect(text).toContain("Dutch oven (Cooking)");
      expect(text).toContain("milk (ordered 1x)");
    });

    it("has readOnlyHint true and no app view", () => {
      registerInventoryTools(makeContext());

      const tool = getCapturedTool("get_shopping_profile");
      expect(
        (tool.config as { annotations?: { readOnlyHint?: boolean } }).annotations?.readOnlyHint,
      ).toBe(true);
      expect((tool.config as { _meta?: { ui?: unknown } })._meta?.ui).toBeUndefined();
    });
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

    const result = await getCapturedHandler("record_order")({
      items: [
        { upc: "0000000000001", productName: "Apples", quantity: 2, price: 1.5 },
        { upc: "0000000000002", productName: "Bananas", quantity: 3 },
      ],
      storeId: "70500847",
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

  it("returns structured content with _view: 'record_order' and all order fields", async () => {
    registerOrderTools(makeContext());

    const result = await getCapturedHandler("record_order")({
      items: [{ upc: "0000000000001", productName: "Apples", quantity: 2, price: 1.5 }],
      storeId: "70500847",
      notes: "Test note",
    });

    expect(result).toMatchObject({
      structuredContent: {
        _view: "record_order",
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

    const result = await getCapturedHandler("record_order")({
      items: [
        { upc: "0000000000001", productName: "Apples", quantity: 2 },
        { upc: "0000000000002", productName: "Bananas", quantity: 3 },
      ],
    });

    expect(isErrorResult(result)).toBe(false);
    const sc = (
      result as {
        structuredContent: { _view: string; estimatedTotal?: number; totalItems: number };
      }
    ).structuredContent;
    expect(sc._view).toBe("record_order");
    expect(sc.totalItems).toBe(5);
    expect(sc.estimatedTotal).toBeUndefined();
  });

  it("still accepts the deprecated productId alias on record_order items", async () => {
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

    const result = await getCapturedHandler("record_order")({
      items: [{ productId: "0000000000001", productName: "Apples", quantity: 2, price: 1.5 }],
    });

    expect(isErrorResult(result)).toBe(false);
    expect(storedOrders).toHaveLength(1);
    expect(storedOrders[0].items[0]).toMatchObject({
      productId: "0000000000001",
      productName: "Apples",
    });
  });

  it("rejects a record_order item with neither upc nor productId at the schema level", () => {
    registerOrderTools(makeContext());

    const tool = getCapturedTool("record_order");
    const config = tool.config as {
      inputSchema: { safeParse: (value: unknown) => { success: boolean } };
    };

    expect(
      config.inputSchema.safeParse({
        items: [{ productName: "Apples", quantity: 2 }],
      }).success,
    ).toBe(false);
    expect(
      config.inputSchema.safeParse({
        items: [{ upc: "0000000000001", productName: "Apples", quantity: 2 }],
      }).success,
    ).toBe(true);
  });

  it("creates a shopping list and returns a short listId", async () => {
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
    expect(sc["listId"]).toMatch(/^list_[0-9a-f]{8}$/);
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

    expect(isErrorResult(result)).toBe(true);
    expect(textFromResult(result)).toContain("at least one item");
  });

  it("returns a fresh listId on each call so lists don't collide", async () => {
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

    const firstId = (first as { structuredContent: { listId: string } }).structuredContent.listId;
    const secondId = (second as { structuredContent: { listId: string } }).structuredContent.listId;
    expect(firstId).not.toBe(secondId);
    expect((first as { structuredContent: { name: string } }).structuredContent.name).toBe("First");
    expect((second as { structuredContent: { name: string } }).structuredContent.name).toBe(
      "Second",
    );
  });

  it("adds items from a persisted shopping list to the Kroger cart by listId", async () => {
    const storage = makeStorage();
    storage.preferredLocation = {
      get: async () => ({
        locationId: "70500847",
        locationName: "QFC Broadway",
        address: "500 Broadway E",
        chain: "QFC",
        setAt: new Date().toISOString(),
      }),
      set: async () => {},
    } as unknown as UserStorage["preferredLocation"];

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
    const listId = (createResult as { structuredContent: { listId: string } }).structuredContent
      .listId;

    registerCartTools(ctx);
    const addHandler = getCapturedHandler("add_shopping_list_to_cart");

    const result = await addHandler({ listId });

    expect(isErrorResult(result)).toBe(false);
    const sc = (result as { structuredContent: Record<string, unknown> }).structuredContent;
    expect(sc["_view"]).toBe("add_shopping_list_to_cart");
    expect(sc["listId"]).toBe(listId);
    expect(sc["name"]).toBe("Dinner");
    expect((sc["items"] as unknown[]).length).toBe(1);
    expect(textFromResult(result)).toContain("at QFC Broadway");
  });

  it("short-circuits a retried add_shopping_list_to_cart call instead of re-adding", async () => {
    const storage = makeStorage();
    storage.preferredLocation = {
      get: async () => ({
        locationId: "70500847",
        locationName: "QFC Broadway",
        address: "500 Broadway E",
        chain: "QFC",
        setAt: new Date().toISOString(),
      }),
      set: async () => {},
    } as unknown as UserStorage["preferredLocation"];

    const ctx = makeContextWithElicit(
      storage,
      { action: "accept", content: { confirm: true } },
      204,
    );

    registerShoppingListTools(ctx);
    registerCartTools(ctx);
    const createHandler = getCapturedHandler("create_shopping_list");
    const addHandler = getCapturedHandler("add_shopping_list_to_cart");

    const createResult = await createHandler({
      name: "Dinner",
      items: [{ productName: "Milk", upc: "0001111042578", quantity: 2 }],
    });
    const listId = (createResult as { structuredContent: { listId: string } }).structuredContent
      .listId;

    const putCalls: unknown[] = [];
    (
      ctx.clients as unknown as { cartClient: { PUT: (...args: unknown[]) => Promise<unknown> } }
    ).cartClient.PUT = async (...args: unknown[]) => {
      putCalls.push(args);
      return { data: undefined, response: new Response(null, { status: 204 }) };
    };

    const first = await addHandler({ listId });
    expect(isErrorResult(first)).toBe(false);
    expect(putCalls).toHaveLength(1);

    const second = await addHandler({ listId });
    expect(isErrorResult(second)).toBe(false);
    expect(putCalls).toHaveLength(1); // no second PUT call
    expect(textFromResult(second)).toContain("already added to your cart from this list");
  });

  it("bails when the shopping list has no items with UPCs", async () => {
    const storage = makeStorage();
    storage.preferredLocation = {
      get: async () => null,
      set: async () => {},
    } as unknown as UserStorage["preferredLocation"];

    const ctx = makeContextWithElicit(storage, { action: "accept" });
    registerShoppingListTools(ctx);
    registerCartTools(ctx);

    const createResult = await getCapturedHandler("create_shopping_list")({
      name: "No UPCs",
      items: [{ productName: "Strawberries", quantity: 2 }],
    });
    const listId = (createResult as { structuredContent: { listId: string } }).structuredContent
      .listId;

    const handler = getCapturedHandler("add_shopping_list_to_cart");
    const result = await handler({ listId, storeId: "70500847" });

    expect(isErrorResult(result)).toBe(false);
    const sc = (result as { structuredContent: Record<string, unknown> }).structuredContent;
    expect((sc["items"] as unknown[]).length).toBe(0);
    expect((sc["needsUpc"] as Array<{ productName: string }>).map((i) => i.productName)).toEqual([
      "Strawberries",
    ]);
    expect(textFromResult(result)).toContain("no items with a UPC");
  });

  it("reports no shopping list found for an unknown or forged listId", async () => {
    const ctx = makeContextWithElicit(makeStorage(), { action: "accept" });
    registerCartTools(ctx);
    const handler = getCapturedHandler("add_shopping_list_to_cart");

    const result = await handler({ listId: "list_deadbeef" });
    expect(isErrorResult(result)).toBe(true);
    expect(textFromResult(result)).toContain("No shopping list found");
  });

  it("aborts add_shopping_list_to_cart when the user declines elicitation", async () => {
    const storage = makeStorage();
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

    const ctx = makeContextWithElicit(storage, { action: "accept" }, 204);
    registerShoppingListTools(ctx);
    registerCartTools(ctx);

    const createResult = await getCapturedHandler("create_shopping_list")({
      name: "Dinner",
      items: [{ productName: "Milk", upc: "0001111042578", quantity: 2 }],
    });
    const listId = (createResult as { structuredContent: { listId: string } }).structuredContent
      .listId;

    // Reconfigure elicitation to decline for the actual add_shopping_list_to_cart call.
    (
      ctx.server as unknown as { server: { elicitInput: () => Promise<ElicitResult> } }
    ).server.elicitInput = async () => ({ action: "decline" });

    const handler = getCapturedHandler("add_shopping_list_to_cart");
    const result = await handler({ listId });
    expect(isErrorResult(result)).toBe(true);
    expect(textFromResult(result)).toContain("cancelled");
  });

  it("adds inline items to the cart without a shopping list", async () => {
    const storage = makeStorage();
    storage.preferredLocation = {
      get: async () => ({
        locationId: "70500847",
        locationName: "QFC Broadway",
        address: "500 Broadway E",
        chain: "QFC",
        setAt: new Date().toISOString(),
      }),
      set: async () => {},
    } as unknown as UserStorage["preferredLocation"];

    const ctx = makeContextWithElicit(
      storage,
      { action: "accept", content: { confirm: true } },
      204,
    );
    registerCartTools(ctx);
    const handler = getCapturedHandler("add_shopping_list_to_cart");

    const result = await handler({
      items: [{ upc: "0001111042578", quantity: 3 }],
    });

    expect(isErrorResult(result)).toBe(false);
    const sc = (result as { structuredContent: Record<string, unknown> }).structuredContent;
    expect(sc["_view"]).toBe("add_shopping_list_to_cart");
    expect((sc["items"] as Array<{ upc: string; quantity: number }>)[0]).toMatchObject({
      upc: "0001111042578",
      quantity: 3,
    });
    expect(textFromResult(result)).toContain("at QFC Broadway");
  });

  it("searches stores with query filters and returns structured stores", async () => {
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

    const result = await getCapturedHandler("search_stores")({
      zipCodeNear: "98122",
      limit: 3,
      chain: "QFC",
    });

    expect(textFromResult(result)).toContain("QFC Broadway");
    expect(result).toMatchObject({
      structuredContent: {
        _view: "search_stores",
        stores: [{ locationId: "70500847", name: "QFC Broadway" }],
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

  it("requires zipCodeNear on search_stores (no default) and defaults limit to 5", () => {
    const context = makeContext();
    registerLocationTools(context);
    const tool = getCapturedTool("search_stores");
    const config = tool.config as {
      inputSchema: {
        safeParse: (v: unknown) => { success: boolean };
        parse: (v: unknown) => { limit: number };
      };
    };

    expect(config.inputSchema.safeParse({}).success).toBe(false);
    expect(config.inputSchema.safeParse({ zipCodeNear: "98122" }).success).toBe(true);
    expect(config.inputSchema.parse({ zipCodeNear: "98122" }).limit).toBe(5);
  });

  it("returns structured store details for a valid storeId", async () => {
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

    const result = await getCapturedHandler("get_store")({
      storeId: "70500847",
    });

    expect(isErrorResult(result)).toBe(false);
    expect(result).toMatchObject({
      structuredContent: {
        _view: "get_store",
        store: {
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

    const result = await getCapturedHandler("get_store")({
      storeId: "70500847",
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

    const result = await getCapturedHandler("set_preferred_store")({
      storeId: "70500847",
    });

    expect(textFromResult(result)).toContain("Preferred location set successfully");
    expect(result).toMatchObject({
      structuredContent: {
        _view: "set_preferred_store",
        store: {
          locationId: "70500847",
          locationName: "QFC Broadway",
        },
      },
    });
    expect(savedLocations).toMatchObject([
      {
        locationId: "70500847",
        locationName: "QFC Broadway",
        address: "500 Broadway E, Seattle, WA 98102",
        chain: "QFC",
      },
    ]);
  });

  it("returns an error when the API returns no data for the given storeId", async () => {
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

    const result = await getCapturedHandler("set_preferred_store")({
      storeId: "70500847",
    });

    expect(isErrorResult(result)).toBe(true);
    expect(textFromResult(result)).toContain("No information found for location ID: 70500847");
  });
});

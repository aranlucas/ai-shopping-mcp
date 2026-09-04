// oxlint-disable perfectionist/sort-imports
// tool-test-harness installs module mocks before the tool modules are imported.
import { beforeEach, describe, expect, it } from "vitest";

import type { UserStorage } from "../../src/tools/types.js";

import {
  getCapturedHandler,
  getCapturedTool,
  makeCartContext,
  makeContext,
  makeProductService,
  makeStorage,
  resetToolTestHarness,
  unauthenticate,
} from "./tool-test-harness.js";
import { registerCartTools } from "../../src/tools/cart.js";
import { registerInventoryTools } from "../../src/tools/inventory.js";
import { registerShoppingListTools } from "../../src/tools/shopping-list.js";
import { buildWeeklyDealsCacheKey } from "../../src/tools/weekly-deals.js";

describe("storage-backed tools", () => {
  beforeEach(() => {
    resetToolTestHarness();
  });

  it("adds pantry items and returns structured view content", async () => {
    registerInventoryTools(makeContext());

    const result = await getCapturedHandler("add_to_inventory")({
      inventory: "pantry",
      items: [{ name: "Milk" }],
    });

    expect(result.text).toContain("Added 1 item(s) to pantry");
    expect(result).toMatchObject({
      _meta: { "dev.aranlucas/view": "pantry" },
      structuredContent: {
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

    expect(result.isError).toBe(true);
    expect(result.text).toContain("Provide items to remove");
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
    expect(removeResult.text).toContain("Removed 1 item(s) from pantry");
    expect(removeResult).toMatchObject({
      structuredContent: {
        items: [{ productName: "Bread", quantity: 2 }],
      },
    });

    const clearResult = await removeHandler({ inventory: "pantry", all: true });
    expect(clearResult).toMatchObject({
      _meta: { "dev.aranlucas/view": "pantry" },
      structuredContent: {
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
    expect(addResult.text).toContain("Added 1 item(s) to equipment");
    expect(addResult).toMatchObject({
      _meta: { "dev.aranlucas/view": "kitchen_equipment" },
      structuredContent: {
        actionDetail: "Added 1 item(s)",
        items: [{ equipmentName: "Dutch oven", category: "Cooking" }],
      },
    });

    const removeResult = await removeHandler({
      inventory: "equipment",
      items: [{ name: "Dutch oven" }],
    });
    expect(removeResult.text).toContain("Removed 1 item(s) from equipment");
    expect(removeResult).toMatchObject({
      _meta: { "dev.aranlucas/view": "kitchen_equipment" },
      structuredContent: {
        actionDetail: "Removed 1 item(s)",
        items: [],
      },
    });

    const clearResult = await removeHandler({ inventory: "equipment", all: true });
    expect(clearResult.text).toBe("Equipment cleared successfully.");
    expect(clearResult).toMatchObject({
      _meta: { "dev.aranlucas/view": "kitchen_equipment" },
      structuredContent: {
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

    expect(addResult.isError).toBe(true);
  });

  describe("get_shopping_profile", () => {
    it("reports 'none set' guidance when no preferred store is set", async () => {
      registerInventoryTools(makeContext());

      const result = await getCapturedHandler("get_shopping_profile")({});

      expect(result.isError).toBe(false);
      const text = result.text;
      expect(text).toContain("none set — use search_stores + set_preferred_store");
      expect(text).toContain("## Pantry");
      expect(text).toContain("empty");
      expect(text).toContain("## Kitchen equipment");
      expect(text).toContain("none");
      expect(text).toContain("## Frequently purchased");
      expect(text).toContain("no order history yet");
      expect(text).toContain("## Due to restock");
      expect(text).toContain("no restock suggestions yet");
    });

    it("lists items due to restock based on order history cadence", async () => {
      const DAY = 24 * 60 * 60 * 1000;
      const now = Date.now();
      const daysAgoIso = (days: number) => new Date(now - days * DAY).toISOString();

      // Milk bought every ~10 days, but the most recent purchase was 30 days
      // ago — well past due.
      const storage = makeStorage({
        orderHistory: {
          getRecent: async () => [
            {
              orderId: "o3",
              items: [{ upc: "0000000000001", productName: "Milk", quantity: 1 }],
              totalItems: 1,
              placedAt: daysAgoIso(30),
            },
            {
              orderId: "o2",
              items: [{ upc: "0000000000001", productName: "Milk", quantity: 1 }],
              totalItems: 1,
              placedAt: daysAgoIso(40),
            },
            {
              orderId: "o1",
              items: [{ upc: "0000000000001", productName: "Milk", quantity: 1 }],
              totalItems: 1,
              placedAt: daysAgoIso(50),
            },
          ],
        } as unknown as UserStorage["orderHistory"],
      });
      registerInventoryTools(makeContext(storage));

      const result = await getCapturedHandler("get_shopping_profile")({});

      const text = result.text;
      expect(text).toContain("## Due to restock");
      expect(text).toContain("Milk (last bought 30d ago, usually every ~10d)");
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
              items: [{ upc: "0000000000001", productName: "Milk", quantity: 1 }],
              totalItems: 1,
              placedAt: new Date().toISOString(),
            },
          ],
        } as unknown as UserStorage["orderHistory"],
      });
      registerInventoryTools(makeContext(storage));

      const result = await getCapturedHandler("get_shopping_profile")({});

      const text = result.text;
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

  it("creates a shopping list and returns a short listId", async () => {
    registerShoppingListTools(
      makeContext(
        undefined,
        makeProductService({ "0001111042578": "Milk", "0009999999999": "Bread" }),
      ),
    );
    const handler = getCapturedHandler("create_shopping_list");

    const result = await handler({
      name: "Tuesday Dinner",
      items: [
        { upc: "0001111042578", quantity: 2 },
        { upc: "0009999999999", quantity: 1 },
      ],
    });

    expect(result.isError).toBe(false);
    const sc = (result as { structuredContent: Record<string, unknown> }).structuredContent;
    expect(result).toMatchObject({
      _meta: { "dev.aranlucas/view": "create_shopping_list" },
    });
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

    expect(result.isError).toBe(true);
    expect(result.text).toContain("at least one item");
  });

  it("returns a fresh listId on each call so lists don't collide", async () => {
    registerShoppingListTools(makeContext());
    const handler = getCapturedHandler("create_shopping_list");

    const first = await handler({
      name: "First",
      items: [{ upc: "0001111000001", quantity: 1 }],
    });
    const second = await handler({
      name: "Second",
      items: [{ upc: "0001111000002", quantity: 2 }],
    });

    const firstId = (first as { structuredContent: { listId: string } }).structuredContent.listId;
    const secondId = (second as { structuredContent: { listId: string } }).structuredContent.listId;
    expect(firstId).not.toBe(secondId);
    expect((first as { structuredContent: { name: string } }).structuredContent.name).toBe("First");
    expect((second as { structuredContent: { name: string } }).structuredContent.name).toBe(
      "Second",
    );
  });

  describe("create_shopping_list pantry/deal flags", () => {
    it("flags an item already in the pantry", async () => {
      const storage = makeStorage({
        pantry: {
          getAll: async () => [
            { productName: "Milk", quantity: 1, addedAt: new Date().toISOString() },
          ],
        } as unknown as UserStorage["pantry"],
      });
      registerShoppingListTools(
        makeContext(storage, makeProductService({ "0001111000001": "Milk" })),
      );

      const result = await getCapturedHandler("create_shopping_list")({
        name: "Groceries",
        items: [{ upc: "0001111000001", quantity: 1 }],
      });

      expect(result.isError).toBe(false);
      expect(result.text).toContain("in pantry");
    });

    it("does not flag an item that isn't in the pantry", async () => {
      const storage = makeStorage({
        pantry: {
          getAll: async () => [
            { productName: "Bread", quantity: 1, addedAt: new Date().toISOString() },
          ],
        } as unknown as UserStorage["pantry"],
      });
      registerShoppingListTools(
        makeContext(storage, makeProductService({ "0001111000001": "Milk" })),
      );

      const result = await getCapturedHandler("create_shopping_list")({
        name: "Groceries",
        items: [{ upc: "0001111000001", quantity: 1 }],
      });

      expect(result.text).not.toContain("in pantry");
    });

    it("flags an item on sale using the weekly-deals KV cache", async () => {
      const store = new Map<string, string>();
      const cacheKey = buildWeeklyDealsCacheKey({ locationId: undefined, limit: 50, pageLimit: 2 });
      const now = Date.now();
      store.set(
        cacheKey,
        JSON.stringify({
          version: 1,
          createdAt: now,
          freshUntil: now + 60_000,
          staleUntil: now + 120_000,
          data: {
            sourceMode: "print_fallback",
            locationId: "default",
            divisionCode: "705",
            warnings: [],
            deals: [
              { id: "d1", title: "Kroger Whole Milk, Gallon", price: "$2.99", source: "print" },
            ],
          },
        }),
      );

      const context = makeContext(undefined, makeProductService({ "0001111000001": "Whole Milk" }));
      context.getEnv = () =>
        ({
          USER_DATA_KV: {
            get: async (key: string) => store.get(key) ?? null,
            put: async (key: string, value: string) => {
              store.set(key, value);
            },
          },
        }) as unknown as Env;
      registerShoppingListTools(context);

      const result = await getCapturedHandler("create_shopping_list")({
        name: "Groceries",
        items: [{ upc: "0001111000001", quantity: 1 }],
      });

      expect(result.isError).toBe(false);
      expect(result.text).toContain("on sale: $2.99");
    });

    it("yields no flag (and no error) for a corrupted weekly-deals cache entry", async () => {
      const store = new Map<string, string>();
      const cacheKey = buildWeeklyDealsCacheKey({ locationId: undefined, limit: 50, pageLimit: 2 });
      store.set(cacheKey, "{not-valid-json");

      const context = makeContext(undefined, makeProductService({ "0001111000001": "Whole Milk" }));
      context.getEnv = () =>
        ({
          USER_DATA_KV: {
            get: async (key: string) => store.get(key) ?? null,
            put: async (key: string, value: string) => {
              store.set(key, value);
            },
          },
        }) as unknown as Env;
      registerShoppingListTools(context);

      const result = await getCapturedHandler("create_shopping_list")({
        name: "Groceries",
        items: [{ upc: "0001111000001", quantity: 1 }],
      });

      expect(result.isError).toBe(false);
      expect(result.text).not.toContain("on sale");
    });
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

    const ctx = makeCartContext(storage, 204);

    registerShoppingListTools(ctx);
    const createHandler = getCapturedHandler("create_shopping_list");
    const createResult = await createHandler({
      name: "Dinner",
      items: [{ upc: "0001111042578", quantity: 2 }],
    });
    const listId = (createResult as { structuredContent: { listId: string } }).structuredContent
      .listId;

    registerCartTools(ctx);
    const addHandler = getCapturedHandler("add_shopping_list_to_cart");

    const result = await addHandler({ listId });

    expect(result.isError).toBe(false);
    const sc = (result as { structuredContent: Record<string, unknown> }).structuredContent;
    expect(result).toMatchObject({
      _meta: { "dev.aranlucas/view": "add_shopping_list_to_cart" },
    });
    expect(sc["listId"]).toBe(listId);
    expect(sc["name"]).toBe("Dinner");
    expect((sc["items"] as unknown[]).length).toBe(1);
    expect(result.text).toContain("at QFC Broadway");
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

    const ctx = makeCartContext(storage, 204);

    registerShoppingListTools(ctx);
    registerCartTools(ctx);
    const createHandler = getCapturedHandler("create_shopping_list");
    const addHandler = getCapturedHandler("add_shopping_list_to_cart");

    const createResult = await createHandler({
      name: "Dinner",
      items: [{ upc: "0001111042578", quantity: 2 }],
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
    expect(first.isError).toBe(false);
    expect(putCalls).toHaveLength(1);

    const second = await addHandler({ listId });
    expect(second.isError).toBe(false);
    expect(putCalls).toHaveLength(1); // no second PUT call
    expect(second.text).toContain("already added to your cart from this list");
  });

  it("emits and subsequently looks up the gateway-created list id", async () => {
    const gatewayListId = `list_${"a".repeat(32)}`;
    const lookups: string[] = [];
    const storage = makeStorage();
    let savedList: Awaited<ReturnType<typeof storage.shoppingList.create>> | null = null;
    storage.shoppingList = {
      create: async (_clientId, name, items) => {
        savedList = { id: gatewayListId, name, items, createdAt: "2026-07-18T00:00:00.000Z" };
        return savedList;
      },
      get: async (id) => {
        lookups.push(id);
        return id === gatewayListId ? savedList : null;
      },
      // This test only covers create-then-look-up, so the editing operations
      // fail loudly rather than pretending to succeed.
      list: async () => {
        throw new Error("shoppingList.list not used by this test");
      },
      addItems: async () => {
        throw new Error("shoppingList.addItems not used by this test");
      },
      updateItem: async () => {
        throw new Error("shoppingList.updateItem not used by this test");
      },
      removeItem: async () => {
        throw new Error("shoppingList.removeItem not used by this test");
      },
      clear: async () => {},
    };

    const ctx = makeCartContext(storage, 204, makeProductService({ "0001111042578": "Milk" }));
    registerShoppingListTools(ctx);
    registerCartTools(ctx);

    const created = await getCapturedHandler("create_shopping_list")({
      name: "Dinner",
      items: [{ upc: "0001111042578", quantity: 1 }],
    });
    expect(created.text).toContain(`listId=${gatewayListId}`);

    const added = await getCapturedHandler("add_shopping_list_to_cart")({
      listId: gatewayListId,
      storeId: "70500847",
    });
    expect(added.isError).toBe(false);
    expect(lookups).toEqual([gatewayListId]);
  });

  it("bails when the shopping list has no items with UPCs", async () => {
    // create_shopping_list always resolves a upc from the input now, so a
    // upc-less item can only reach the cart tool via a pre-existing stored
    // list (e.g. a matched product missing its own upc from Kroger's API —
    // see shop_for_items's LineItem filtering). Seed storage directly to
    // exercise that path.
    const storage = makeStorage();
    storage.preferredLocation = {
      get: async () => null,
      set: async () => {},
    } as unknown as UserStorage["preferredLocation"];

    const ctx = makeCartContext(storage);
    registerCartTools(ctx);

    const listId = "list_deadbeef";
    await storage.shoppingList.create(listId, "No UPCs", [
      { productName: "Strawberries", quantity: 2 },
    ]);

    const handler = getCapturedHandler("add_shopping_list_to_cart");
    const result = await handler({ listId, storeId: "70500847" });

    expect(result.isError).toBe(false);
    const sc = (result as { structuredContent: Record<string, unknown> }).structuredContent;
    expect((sc["items"] as unknown[]).length).toBe(0);
    expect((sc["needsUpc"] as Array<{ productName: string }>).map((i) => i.productName)).toEqual([
      "Strawberries",
    ]);
    expect(result.text).toContain("no Kroger product references");
  });

  it("reports no shopping list found for an unknown or forged listId", async () => {
    const ctx = makeCartContext(makeStorage());
    registerCartTools(ctx);
    const handler = getCapturedHandler("add_shopping_list_to_cart");

    const result = await handler({ listId: "list_deadbeef" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("No shopping list found");
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

    const ctx = makeCartContext(storage, 204);
    registerCartTools(ctx);
    const handler = getCapturedHandler("add_shopping_list_to_cart");

    const result = await handler({
      items: [{ upc: "0001111042578", quantity: 3 }],
    });

    expect(result.isError).toBe(false);
    const sc = (result as { structuredContent: Record<string, unknown> }).structuredContent;
    expect(result).toMatchObject({
      _meta: { "dev.aranlucas/view": "add_shopping_list_to_cart" },
    });
    expect((sc["items"] as Array<{ upc: string; quantity: number }>)[0]).toMatchObject({
      upc: "0001111042578",
      quantity: 3,
    });
    expect(result.text).toContain("at QFC Broadway");
  });
});

// oxlint-disable perfectionist/sort-imports
// tool-test-harness installs module mocks before the tool modules are imported.
import { beforeEach, describe, expect, it } from "vitest";

import type { ShoppingStore } from "../../src/utils/shopping-store.js";
import type { KvLike } from "../../src/utils/kv.js";

import {
  getCapturedHandler,
  makeCartContext,
  makeContext,
  makeProductService,
  makeStorage,
  resetToolTestHarness,
} from "./tool-test-harness.js";
import { registerCartTools as registerCartToolsImpl } from "../../src/tools/cart.js";
import { registerShoppingListTools as registerShoppingListToolsImpl } from "../../src/tools/shopping-list.js";
import { buildWeeklyDealsCacheKey } from "../../src/tools/weekly-deals.js";

type TestContext = ReturnType<typeof makeContext>;

function registerCartTools(fixture: TestContext) {
  registerCartToolsImpl(fixture.server, fixture);
}

function registerShoppingListTools(fixture: TestContext) {
  registerShoppingListToolsImpl(fixture.server, fixture);
}

describe("storage-backed tools", () => {
  beforeEach(() => {
    resetToolTestHarness();
  });

  it("creates a shopping list and returns the storage-owned listId", async () => {
    const storage = makeStorage();
    registerShoppingListTools(
      makeContext(
        storage,
        makeProductService({
          "0001111042578": "Milk",
          "0009999999999": "Bread",
        }),
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
    const sc = (result as { structuredContent: Record<string, unknown> })
      .structuredContent;
    expect(result).toMatchObject({
      _meta: { "dev.aranlucas/view": "create_shopping_list" },
    });
    expect(
      await storage.shoppingList.get(sc["listId"] as string),
    ).toMatchObject({ name: "Tuesday Dinner" });
    expect(sc["name"]).toBe("Tuesday Dinner");
    expect(
      (sc["items"] as Array<{ productName: string }>).map((i) => i.productName),
    ).toEqual(["Milk", "Bread"]);
  });

  it("rejects shopping list creation with empty items before touching storage", async () => {
    const storage = makeStorage();
    registerShoppingListTools(makeContext(storage));
    const handler = getCapturedHandler("create_shopping_list");

    await expect(handler({ name: "Empty", items: [] })).rejects.toThrow(
      "at least one item",
    );
    expect(await storage.shoppingList.list()).toEqual([]);
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

    const firstId = (first as { structuredContent: { listId: string } })
      .structuredContent.listId;
    const secondId = (second as { structuredContent: { listId: string } })
      .structuredContent.listId;
    expect(firstId).not.toBe(secondId);
    expect(
      (first as { structuredContent: { name: string } }).structuredContent.name,
    ).toBe("First");
    expect(
      (second as { structuredContent: { name: string } }).structuredContent
        .name,
    ).toBe("Second");
  });

  describe("create_shopping_list pantry/deal flags", () => {
    it("flags an item already in the pantry", async () => {
      const storage = makeStorage({
        pantry: {
          getAll: async () => [
            {
              productName: "Milk",
              quantity: 1,
              addedAt: new Date().toISOString(),
            },
          ],
        } as unknown as ShoppingStore["pantry"],
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
            {
              productName: "Bread",
              quantity: 1,
              addedAt: new Date().toISOString(),
            },
          ],
        } as unknown as ShoppingStore["pantry"],
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
      const cacheKey = buildWeeklyDealsCacheKey({
        locationId: undefined,
        limit: 50,
        pageLimit: 2,
      });
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
              {
                id: "d1",
                title: "Kroger Whole Milk, Gallon",
                price: "$2.99",
                source: "print",
              },
            ],
          },
        }),
      );

      const context = makeContext(
        undefined,
        makeProductService({ "0001111000001": "Whole Milk" }),
      );
      context.cache = {
        get: async (key: string) => store.get(key) ?? null,
        put: async (key: string, value: string) => {
          store.set(key, value);
        },
      } as unknown as KvLike;
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
      const cacheKey = buildWeeklyDealsCacheKey({
        locationId: undefined,
        limit: 50,
        pageLimit: 2,
      });
      store.set(cacheKey, "{not-valid-json");

      const context = makeContext(
        undefined,
        makeProductService({ "0001111000001": "Whole Milk" }),
      );
      context.cache = {
        get: async (key: string) => store.get(key) ?? null,
        put: async (key: string, value: string) => {
          store.set(key, value);
        },
      } as unknown as KvLike;
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
    } as unknown as ShoppingStore["preferredLocation"];

    const ctx = makeCartContext(storage, 204);

    registerShoppingListTools(ctx);
    const createHandler = getCapturedHandler("create_shopping_list");
    const createResult = await createHandler({
      name: "Dinner",
      items: [{ upc: "0001111042578", quantity: 2 }],
    });
    const listId = (createResult as { structuredContent: { listId: string } })
      .structuredContent.listId;

    registerCartTools(ctx);
    const addHandler = getCapturedHandler("add_shopping_list_to_cart");

    const result = await addHandler({ listId });

    expect(result.isError).toBe(false);
    const sc = (result as { structuredContent: Record<string, unknown> })
      .structuredContent;
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
    } as unknown as ShoppingStore["preferredLocation"];

    const ctx = makeCartContext(storage, 204);

    registerShoppingListTools(ctx);
    registerCartTools(ctx);
    const createHandler = getCapturedHandler("create_shopping_list");
    const addHandler = getCapturedHandler("add_shopping_list_to_cart");

    const createResult = await createHandler({
      name: "Dinner",
      items: [{ upc: "0001111042578", quantity: 2 }],
    });
    const listId = (createResult as { structuredContent: { listId: string } })
      .structuredContent.listId;

    const putCalls: unknown[] = [];
    ctx.cartClient.PUT = (async (...args: unknown[]) => {
      putCalls.push(args);
      return { data: undefined, response: new Response(null, { status: 204 }) };
    }) as typeof ctx.cartClient.PUT;

    const first = await addHandler({ listId });
    expect(first.isError).toBe(false);
    expect(putCalls).toHaveLength(1);

    const second = await addHandler({ listId });
    expect(second.isError).toBe(false);
    expect(putCalls).toHaveLength(1); // no second PUT call
    expect(second.text).toContain("already added to your Kroger cart");
  });

  it("emits and subsequently looks up the storage-created list id", async () => {
    const gatewayListId = `list_${"a".repeat(32)}`;
    const lookups: string[] = [];
    const storage = makeStorage();
    let savedList: Awaited<
      ReturnType<typeof storage.shoppingList.create>
    > | null = null;
    storage.shoppingList = {
      create: async ({ name, items }) => {
        savedList = {
          id: gatewayListId,
          name,
          items: items.map((item) => ({
            ...item,
            id: crypto.randomUUID(),
            checked: false,
          })),
          createdAt: "2026-07-18T00:00:00.000Z",
        };
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
    };

    const ctx = makeCartContext(
      storage,
      204,
      makeProductService({ "0001111042578": "Milk" }),
    );
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
    // Name-only list items need matching before they can enter the cart.
    const storage = makeStorage();
    storage.preferredLocation = {
      get: async () => null,
      set: async () => {},
    } as unknown as ShoppingStore["preferredLocation"];

    const ctx = makeCartContext(storage);
    registerCartTools(ctx);

    const { id: listId } = await storage.shoppingList.create({
      name: "No UPCs",
      items: [{ productName: "Strawberries", quantity: 2 }],
    });

    const handler = getCapturedHandler("add_shopping_list_to_cart");
    const result = await handler({ listId, storeId: "70500847" });

    expect(result.isError).toBe(false);
    const sc = (result as { structuredContent: Record<string, unknown> })
      .structuredContent;
    expect((sc["items"] as unknown[]).length).toBe(0);
    expect(
      (sc["needsUpc"] as Array<{ productName: string }>).map(
        (i) => i.productName,
      ),
    ).toEqual(["Strawberries"]);
    expect(result.text).toContain("no matched Kroger UPCs");
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
    } as unknown as ShoppingStore["preferredLocation"];

    const ctx = makeCartContext(storage, 204);
    registerCartTools(ctx);
    const handler = getCapturedHandler("add_shopping_list_to_cart");

    const result = await handler({
      items: [{ upc: "0001111042578", quantity: 3 }],
    });

    expect(result.isError).toBe(false);
    const sc = (result as { structuredContent: Record<string, unknown> })
      .structuredContent;
    expect(result).toMatchObject({
      _meta: { "dev.aranlucas/view": "add_shopping_list_to_cart" },
    });
    expect(
      (sc["items"] as Array<{ upc: string; quantity: number }>)[0],
    ).toMatchObject({
      upc: "0001111042578",
      quantity: 3,
    });
    expect(result.text).toContain("at QFC Broadway");
  });
});

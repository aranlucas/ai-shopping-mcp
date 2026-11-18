import { err } from "neverthrow";
import { storageError } from "@/errors.js";
import { env } from "cloudflare:test";
import { createD1ShoppingStore } from "@/utils/d1-shopping-storage.js";
import { ensureShoppingSchema } from "@test/d1-schema.js";
/**
 * Covers the human-editable list surface: reading lists and their item ids,
 * and update_shopping_list's add / change / remove batch.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ShoppingListItem, StoredShoppingListItem } from "@/domain/shopping.js";
import type { ShoppingStore } from "@/utils/shopping-store.js";

import { registerShoppingListTools as registerShoppingListToolsImpl } from "@/tools/shopping-list.js";
import {
  getCapturedHandler,
  getCapturedTool,
  makeContext,
  makeStorage,
  makeProductService,
  resetToolTestHarness,
} from "@test/tools/tool-test-harness.js";

type ListStore = ShoppingStore["shoppingList"];

function registerShoppingListTools(fixture: ReturnType<typeof makeContext>) {
  registerShoppingListToolsImpl(fixture.server, fixture);
}

function makeListStorage(overrides: Partial<ListStore>) {
  const storage = makeStorage();
  storage.shoppingList = { ...storage.shoppingList, ...overrides };

  return storage;
}

beforeAll(ensureShoppingSchema);

async function setupEdit(items: ShoppingListItem[] = []) {
  const storage = makeStorage();
  storage.shoppingList = createD1ShoppingStore(env.SHOPPING_DB, crypto.randomUUID()).shoppingList;
  const list = await storage.shoppingList.create({ name: "Weekly", items });
  const fixture = makeContext(storage, makeProductService({ "0001111042578": "Whole Milk" }));
  registerShoppingListTools(fixture);

  return {
    list,
    fixture,
    update: getCapturedHandler("update_shopping_list"),
    read: () => storage.shoppingList.get(list.id),
  };
}

function storedItem(overrides: Partial<StoredShoppingListItem> = {}): StoredShoppingListItem {
  return {
    id: "item-1",
    checked: false,
    productName: "Milk",
    quantity: 1,
    ...overrides,
  };
}

describe("shopping list editing tools", () => {
  beforeEach(() => {
    resetToolTestHarness();
  });

  it("requires an explicit zero to remove an item through quantity", () => {
    registerShoppingListTools(makeContext());
    const schema = getCapturedTool("update_shopping_list").config.inputSchema;

    for (const invalid of [null, false, "", " ", []]) {
      expect(
        schema.safeParse({
          listId: "list-a",
          change: [{ itemId: "item-1", checked: true, quantity: invalid }],
        }).success,
      ).toBe(false);
    }

    for (const zero of [0, "0"]) {
      expect(
        schema.parse({ listId: "list-a", change: [{ itemId: "item-1", quantity: zero }] }),
      ).toMatchObject({ change: [{ quantity: 0 }] });
    }
  });

  it("lists saved lists with their ids when no listId is given", async () => {
    const storage = makeListStorage({
      list: async () => [
        {
          id: "list-a",
          name: "Tuesday dinner",
          itemCount: 3,
          updatedAt: "2026-08-01T00:00:00Z",
        },
      ],
    });

    const fixture = makeContext(storage);
    registerShoppingListTools(fixture);

    const result = await getCapturedHandler("get_shopping_list")({});

    expect(result.isError).toBe(false);
    expect(result.text).toContain("listId=list-a");
    expect(result.text).toContain("Tuesday dinner");
  });

  it("returns each item's itemId so an edit can address it", async () => {
    const storage = makeListStorage({
      get: async () => ({
        id: "list-a",
        name: "Tuesday dinner",
        items: [storedItem({ id: "item-7", productName: "Chili Onion Crunch" })],
        createdAt: "2026-08-01T00:00:00Z",
      }),
    });

    const fixture = makeContext(storage);
    registerShoppingListTools(fixture);

    const result = await getCapturedHandler("get_shopping_list")({
      listId: "list-a",
    });

    expect(result.text).toContain("itemId=item-7");
    expect(result.text).toContain("Chili Onion Crunch");
  });

  it("points at the index when the listId does not exist", async () => {
    const storage = makeListStorage({ get: async () => null });
    const fixture = makeContext(storage);
    registerShoppingListTools(fixture);

    const result = await getCapturedHandler("get_shopping_list")({
      listId: "missing",
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("get_shopping_list with no listId");
  });

  it("appends an item that has a name but no UPC", async () => {
    const { list, update, read } = await setupEdit();

    const result = await update({
      listId: list.id,
      add: [{ productName: "Chili Onion Crunch", notes: "Sample Catalog" }],
    });

    expect(result.isError).toBe(false);
    const saved = await read();
    expect(saved?.items).toMatchObject([
      { productName: "Chili Onion Crunch", quantity: 1, notes: "Sample Catalog" },
    ]);
    expect(result.text).toContain(`itemId=${String(saved?.items[0].id)}`);
  });

  it("looks a name up from the UPC when only a UPC is given", async () => {
    const { list, update, read } = await setupEdit();
    await update({ listId: list.id, add: [{ upc: "0001111042578", quantity: 2 }] });
    expect((await read())?.items).toMatchObject([
      { upc: "0001111042578", productName: "Whole Milk", quantity: 2 },
    ]);
  });

  it("rejects oversized create and add batches before catalog or storage work", async () => {
    const fixture = makeContext();
    registerShoppingListTools(fixture);
    const enrich = vi.spyOn(fixture.productService, "enrichProductNames");
    const create = vi.spyOn(fixture.shoppingList, "create");
    const add = vi.spyOn(fixture.shoppingList, "edit");

    const items = Array.from({ length: 41 }, (_, index) => ({
      upc: String(index),
    }));

    await expect(
      getCapturedHandler("create_shopping_list")({ name: "Large list", items }),
    ).rejects.toThrow("Too big");
    await expect(
      getCapturedHandler("update_shopping_list")({
        listId: "list-a",
        add: items,
      }),
    ).rejects.toThrow("Too big");

    expect(enrich).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it("rejects an item with neither a UPC nor a name", () => {
    const fixture = makeContext();
    registerShoppingListTools(fixture);
    const { config } = getCapturedTool("update_shopping_list");

    const { inputSchema } = config;

    expect(inputSchema.safeParse({ listId: "list-a", add: [{ quantity: 1 }] }).success).toBe(false);
  });

  it("attaches a selected UPC to the existing row and rejects misspelled edit fields", async () => {
    const fixture = makeContext();
    registerShoppingListTools(fixture);

    const list = await fixture.shoppingList.create({
      name: "Weekly",
      items: [{ productName: "Milk", notes: "Whole", quantity: 2 }],
    });

    const itemId = list.items[0].id;
    const update = getCapturedHandler("update_shopping_list");
    await expect(
      update({ listId: list.id, change: [{ itemId, productName: "Whole Milk", ucp: "123" }] }),
    ).rejects.toThrow(/ucp/);
    const result = await update({ listId: list.id, change: [{ itemId, upc: "123" }] });
    expect(result.isError).toBe(false);
    expect((await fixture.shoppingList.get(list.id))?.items).toEqual([
      { ...list.items[0], id: itemId, upc: "0000000000123", notes: "Whole", quantity: 2 },
    ]);
  });

  it("rejects productRef instead of UPC", () => {
    const fixture = makeContext();
    registerShoppingListTools(fixture);
    const { config } = getCapturedTool("update_shopping_list");

    const { inputSchema } = config;

    expect(
      inputSchema.safeParse({
        listId: "list-a",
        add: [{ productRef: "kroger:1", productName: "Milk" }],
      }).success,
    ).toBe(false);
    expect(inputSchema.safeParse({ listId: "list-a" }).success).toBe(false);
  });

  it("commits removals by name or zero, patches only supplied fields, and returns added IDs", async () => {
    const { list, update, read } = await setupEdit([
      { productName: "Milk", quantity: 1, notes: "Whole" },
      { productName: "Bread", quantity: 1 },
      { productName: "Cheddar", quantity: 1 },
      { productName: "Butter", quantity: 1 },
    ]);

    const [milk, bread, , butter] = list.items;

    const result = await update({
      listId: list.id,
      remove: ["cheddar"],
      change: [
        { itemId: milk.id, quantity: 2 },
        { itemId: bread.id, checked: true },
        { itemId: butter.id, quantity: 0 },
      ],
      add: [{ productName: "Eggs" }],
    });

    expect(result.isError).toBe(false);
    const saved = await read();
    expect(saved?.items).toMatchObject([
      { ...milk, quantity: 2 },
      { ...bread, checked: true },
      { productName: "Eggs", checked: false },
    ]);
    expect(result.text).toContain(`Removed itemId=${butter.id}`);
    expect(result.text).toContain("checked off");
    expect(result.text).toContain(`Added itemId=${String(saved?.items[2].id)}`);
  });

  it("retains concurrent additions to the same saved list", async () => {
    const { list, update, read } = await setupEdit();

    const results = await Promise.all(
      ["Peas", "Carrots"].map((productName) => update({ listId: list.id, add: [{ productName }] })),
    );

    expect(results.map((result) => result.isError)).toEqual([false, false]);
    expect((await read())?.items.map((item) => item.productName).toSorted()).toEqual([
      "Carrots",
      "Peas",
    ]);
  });

  it("accepts a fractional ingredient and rejects fractional packages before adding rows", async () => {
    const { list, update, read } = await setupEdit();
    await update({ listId: list.id, add: [{ productName: "Flour", quantity: 0.5 }] });
    await expect(update({ listId: list.id, add: [{ upc: "123", quantity: 1.5 }] })).rejects.toThrow(
      /whole package count/,
    );
    expect((await read())?.items).toMatchObject([{ productName: "Flour", quantity: 0.5 }]);
  });

  it("preserves every item when a later change is invalid", async () => {
    const { list, update, read } = await setupEdit([
      { productName: "Milk", quantity: 1 },
      { productName: "Bread", quantity: 1 },
    ]);

    const result = await update({
      listId: list.id,
      remove: ["Bread"],
      change: [
        { itemId: list.items[0].id, quantity: 2 },
        { itemId: "missing", checked: true },
      ],
    });

    expect(result.isError).toBe(true);
    expect((await read())?.items).toEqual(list.items);
  });

  it("preserves the list when a replacement UPC lookup fails", async () => {
    const { list, update, fixture, read } = await setupEdit([{ productName: "Milk", quantity: 1 }]);
    vi.spyOn(fixture.productService, "enrichProductNames").mockResolvedValue(
      err(storageError("Catalog unavailable")),
    );
    const result = await update({ listId: list.id, remove: ["Milk"], add: [{ upc: "123" }] });
    expect(result.isError).toBe(true);
    expect((await read())?.items).toEqual(list.items);
  });

  it("asks for a field rather than silently doing nothing", async () => {
    const { list, update } = await setupEdit([{ productName: "Milk", quantity: 1 }]);
    const result = await update({ listId: list.id, change: [{ itemId: list.items[0].id }] });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("needs productName, quantity");
  });

  it("changes nothing when a removal names an unknown item", async () => {
    const { list, update, read } = await setupEdit([{ productName: "Milk", quantity: 1 }]);
    const result = await update({ listId: list.id, remove: ["Milk", "Caviar"] });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('No item "Caviar"');
    expect(result.text).toContain(`itemId=${list.items[0].id} Milk`);
    expect((await read())?.items).toEqual(list.items);
  });
});

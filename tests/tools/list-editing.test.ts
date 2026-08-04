/**
 * Covers the human-editable list surface: reading lists and their item ids,
 * appending items that have no Kroger UPC (Trader Joe's products, plain
 * ingredients), editing one item, and deleting one.
 */
import { okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolContext } from "../../src/tools/types.js";
import type { ShoppingListItem } from "../../src/utils/user-storage.js";

import { registerShoppingListTools } from "../../src/tools/shopping-list.js";
import { registerTraderJoesTools } from "../../src/tools/trader-joes.js";
import {
  getCapturedHandler,
  getCapturedTool,
  isErrorResult,
  makeContext,
  makeStorage,
  resetToolTestHarness,
  textFromResult,
} from "./tool-test-harness.js";

type ListStore = ToolContext["storage"]["shoppingList"];

function makeListStorage(overrides: Partial<ListStore>) {
  const storage = makeStorage();
  storage.shoppingList = { ...storage.shoppingList, ...overrides } as ListStore;
  return storage;
}

function storedItem(overrides: Partial<ShoppingListItem> = {}): ShoppingListItem {
  return { id: "item-1", productName: "Milk", quantity: 1, ...overrides };
}

describe("shopping list editing tools", () => {
  beforeEach(() => {
    resetToolTestHarness();
  });

  it("lists saved lists with their ids when no listId is given", async () => {
    const storage = makeListStorage({
      list: async () => [
        { id: "list-a", name: "Tuesday dinner", itemCount: 3, updatedAt: "2026-08-01T00:00:00Z" },
      ],
    });
    registerShoppingListTools(makeContext(storage));

    const result = await getCapturedHandler("get_shopping_list")({});

    expect(isErrorResult(result)).toBe(false);
    expect(textFromResult(result)).toContain("listId=list-a");
    expect(textFromResult(result)).toContain("Tuesday dinner");
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
    registerShoppingListTools(makeContext(storage));

    const result = await getCapturedHandler("get_shopping_list")({ listId: "list-a" });

    expect(textFromResult(result)).toContain("itemId=item-7");
    expect(textFromResult(result)).toContain("Chili Onion Crunch");
  });

  it("points at the index when the listId does not exist", async () => {
    const storage = makeListStorage({ get: async () => null });
    registerShoppingListTools(makeContext(storage));

    const result = await getCapturedHandler("get_shopping_list")({ listId: "missing" });

    expect(isErrorResult(result)).toBe(true);
    expect(textFromResult(result)).toContain("get_shopping_list with no listId");
  });

  it("appends an item that has a name but no UPC", async () => {
    const addItems = vi.fn(async (_listId: string, items: ShoppingListItem[]) =>
      items.map((item, index) => ({ ...item, id: `item-${index + 1}` })),
    );
    registerShoppingListTools(makeContext(makeListStorage({ addItems })));

    const result = await getCapturedHandler("add_shopping_list_items")({
      listId: "list-a",
      items: [{ productName: "Chili Onion Crunch", notes: "Trader Joe's" }],
    });

    expect(isErrorResult(result)).toBe(false);
    expect(addItems).toHaveBeenCalledWith("list-a", [
      { productName: "Chili Onion Crunch", quantity: 1, notes: "Trader Joe's" },
    ]);
    expect(textFromResult(result)).toContain("itemId=item-1");
  });

  it("looks a name up from the UPC when only a UPC is given", async () => {
    const addItems = vi.fn(async (_listId: string, items: ShoppingListItem[]) =>
      items.map((item) => ({ ...item, id: "item-1" })),
    );
    const ctx = makeContext(makeListStorage({ addItems }));
    ctx.productService = {
      enrichProductName: async () => "Whole Milk",
    } as unknown as ToolContext["productService"];
    registerShoppingListTools(ctx);

    await getCapturedHandler("add_shopping_list_items")({
      listId: "list-a",
      items: [{ upc: "0001111042578", quantity: 2 }],
    });

    expect(addItems).toHaveBeenCalledWith("list-a", [
      { productName: "Whole Milk", upc: "0001111042578", quantity: 2 },
    ]);
  });

  it("rejects an item with neither a UPC nor a name", () => {
    registerShoppingListTools(makeContext());
    const { config } = getCapturedTool("add_shopping_list_items");
    const { inputSchema } = config as {
      inputSchema: { safeParse: (input: unknown) => { success: boolean } };
    };

    expect(inputSchema.safeParse({ listId: "list-a", items: [{ quantity: 1 }] }).success).toBe(
      false,
    );
  });

  it("edits only the fields it is given", async () => {
    const updateItem = vi.fn(async () => storedItem({ quantity: 3 }));
    registerShoppingListTools(makeContext(makeListStorage({ updateItem })));

    const result = await getCapturedHandler("edit_shopping_list_item")({
      listId: "list-a",
      itemId: "item-1",
      quantity: 3,
    });

    expect(isErrorResult(result)).toBe(false);
    expect(updateItem).toHaveBeenCalledWith("list-a", "item-1", { quantity: 3 });
  });

  it("checks an item off without deleting it", async () => {
    const updateItem = vi.fn(async () => storedItem({ checked: true }));
    const removeItem = vi.fn(async () => {});
    registerShoppingListTools(makeContext(makeListStorage({ updateItem, removeItem })));

    const result = await getCapturedHandler("edit_shopping_list_item")({
      listId: "list-a",
      itemId: "item-1",
      checked: true,
    });

    expect(updateItem).toHaveBeenCalledWith("list-a", "item-1", { checked: true });
    expect(removeItem).not.toHaveBeenCalled();
    expect(textFromResult(result)).toContain("checked off");
  });

  it("deletes the item when remove is set, without also patching it", async () => {
    const updateItem = vi.fn(async () => storedItem());
    const removeItem = vi.fn(async () => {});
    registerShoppingListTools(makeContext(makeListStorage({ updateItem, removeItem })));

    const result = await getCapturedHandler("edit_shopping_list_item")({
      listId: "list-a",
      itemId: "item-1",
      remove: true,
    });

    expect(removeItem).toHaveBeenCalledWith("list-a", "item-1");
    expect(updateItem).not.toHaveBeenCalled();
    expect(textFromResult(result)).toContain("Removed itemId=item-1");
  });

  it("asks for a field rather than silently doing nothing", async () => {
    registerShoppingListTools(makeContext(makeListStorage({})));

    const result = await getCapturedHandler("edit_shopping_list_item")({
      listId: "list-a",
      itemId: "item-1",
    });

    expect(isErrorResult(result)).toBe(true);
    expect(textFromResult(result)).toContain("remove=true");
  });
});

describe("Trader Joe's search tool", () => {
  beforeEach(() => {
    resetToolTestHarness();
  });

  it("names each match so it can be passed straight to a list", async () => {
    const ctx = makeContext();
    ctx.traderJoes = {
      searchProducts: () =>
        okAsync({
          storeCode: "701",
          products: [
            {
              sku: "076892",
              name: "Chili Onion Crunch",
              price: 3.99,
              size: "6 Ounce",
              available: true,
            },
          ],
        }),
    };
    registerTraderJoesTools(ctx);

    const result = await getCapturedHandler("search_trader_joes_products")({
      query: "chili crunch",
      limit: 10,
    });

    expect(isErrorResult(result)).toBe(false);
    expect(textFromResult(result)).toContain('name="Chili Onion Crunch"');
    expect(textFromResult(result)).toContain("sku=076892");
    expect(textFromResult(result)).toContain("$3.99");
    expect(textFromResult(result)).toContain("add_shopping_list_items");
  });

  it("says so plainly when nothing matches", async () => {
    const ctx = makeContext();
    ctx.traderJoes = { searchProducts: () => okAsync({ storeCode: "701", products: [] }) };
    registerTraderJoesTools(ctx);

    const result = await getCapturedHandler("search_trader_joes_products")({
      query: "unobtainium",
      limit: 10,
    });

    expect(isErrorResult(result)).toBe(false);
    expect(textFromResult(result)).toContain("No Trader Joe's products matched");
  });
});

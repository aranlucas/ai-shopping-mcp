/**
 * Covers the human-editable list surface: reading lists and their item ids,
 * and update_shopping_list's add / change / remove batch.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProductService } from "../../src/services/kroger/product-service.js";
import type {
  ShoppingListItem,
  StoredShoppingListItem,
  ShoppingListItemPatch,
} from "../../src/domain/shopping.js";
import type { ShoppingStore } from "../../src/utils/shopping-store.js";

import { registerShoppingListTools as registerShoppingListToolsImpl } from "../../src/tools/shopping-list.js";
import {
  getCapturedHandler,
  getCapturedTool,
  makeContext,
  makeStorage,
  resetToolTestHarness,
} from "./tool-test-harness.js";

type ListStore = ShoppingStore["shoppingList"];

function registerShoppingListTools(
  serverOrFixture: ReturnType<typeof makeContext> | unknown,
  maybeFixture?: ReturnType<typeof makeContext>,
) {
  const fixture = (maybeFixture ?? serverOrFixture) as ReturnType<
    typeof makeContext
  >;
  registerShoppingListToolsImpl(fixture.server, fixture);
}

function makeListStorage(overrides: Partial<ListStore>) {
  const storage = makeStorage();
  storage.shoppingList = { ...storage.shoppingList, ...overrides } as ListStore;
  return storage;
}

/** A stored list containing the given items, for `get` stubs. */
function listWith(...items: StoredShoppingListItem[]) {
  return async () => ({
    id: "list-a",
    name: "Weekly",
    items,
    createdAt: "2026-08-01T00:00:00Z",
  });
}

function storedItem(
  overrides: Partial<StoredShoppingListItem> = {},
): StoredShoppingListItem {
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
    registerShoppingListTools(fixture.server, fixture);

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
        items: [
          storedItem({ id: "item-7", productName: "Chili Onion Crunch" }),
        ],
        createdAt: "2026-08-01T00:00:00Z",
      }),
    });
    const fixture = makeContext(storage);
    registerShoppingListTools(fixture.server, fixture);

    const result = await getCapturedHandler("get_shopping_list")({
      listId: "list-a",
    });

    expect(result.text).toContain("itemId=item-7");
    expect(result.text).toContain("Chili Onion Crunch");
  });

  it("points at the index when the listId does not exist", async () => {
    const storage = makeListStorage({ get: async () => null });
    const fixture = makeContext(storage);
    registerShoppingListTools(fixture.server, fixture);

    const result = await getCapturedHandler("get_shopping_list")({
      listId: "missing",
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("get_shopping_list with no listId");
  });

  it("appends an item that has a name but no UPC", async () => {
    const addItems = vi.fn<
      (
        listId: string,
        items: ShoppingListItem[],
      ) => Promise<StoredShoppingListItem[]>
    >(async (_listId, items) =>
      items.map((item, index) => ({
        ...item,
        checked: false,
        id: `item-${index + 1}`,
      })),
    );
    const fixture = makeContext(makeListStorage({ addItems }));
    registerShoppingListTools(fixture.server, fixture);

    const result = await getCapturedHandler("update_shopping_list")({
      listId: "list-a",
      add: [{ productName: "Chili Onion Crunch", notes: "Sample Catalog" }],
    });

    expect(result.isError).toBe(false);
    expect(addItems).toHaveBeenCalledWith("list-a", [
      {
        productName: "Chili Onion Crunch",
        quantity: 1,
        notes: "Sample Catalog",
      },
    ]);
    expect(result.text).toContain("itemId=item-1");
  });

  it("looks a name up from the UPC when only a UPC is given", async () => {
    const addItems = vi.fn<
      (
        listId: string,
        items: ShoppingListItem[],
      ) => Promise<StoredShoppingListItem[]>
    >(async (_listId, items) =>
      items.map((item) => ({ ...item, checked: false, id: "item-1" })),
    );
    const ctx = makeContext(makeListStorage({ addItems }));
    ctx.productService = {
      getProduct: () => {
        throw new Error("productService not used in this test");
      },
      enrichProductName: async () => "Whole Milk",
    } as unknown as Pick<ProductService, "getProduct" | "enrichProductName">;
    registerShoppingListTools(ctx.server, ctx);

    await getCapturedHandler("update_shopping_list")({
      listId: "list-a",
      add: [{ upc: "0001111042578", quantity: 2 }],
    });

    expect(addItems).toHaveBeenCalledWith("list-a", [
      {
        upc: "0001111042578",
        productName: "Whole Milk",
        quantity: 2,
      },
    ]);
  });

  it("rejects an item with neither a UPC nor a name", () => {
    const fixture = makeContext();
    registerShoppingListTools(fixture.server, fixture);
    const { config } = getCapturedTool("update_shopping_list");
    const { inputSchema } = config as {
      inputSchema: { safeParse: (input: unknown) => { success: boolean } };
    };

    expect(
      inputSchema.safeParse({ listId: "list-a", add: [{ quantity: 1 }] })
        .success,
    ).toBe(false);
  });

  it("rejects productRef instead of UPC", () => {
    const fixture = makeContext();
    registerShoppingListTools(fixture.server, fixture);
    const { config } = getCapturedTool("update_shopping_list");
    const { inputSchema } = config as {
      inputSchema: { safeParse: (input: unknown) => { success: boolean } };
    };

    expect(
      inputSchema.safeParse({
        listId: "list-a",
        add: [{ productRef: "kroger:1", productName: "Milk" }],
      }).success,
    ).toBe(false);
    expect(inputSchema.safeParse({ listId: "list-a" }).success).toBe(false);
  });

  it("edits only the fields it is given", async () => {
    const updateItem = vi.fn<
      (
        listId: string,
        itemId: string,
        patch: ShoppingListItemPatch,
      ) => Promise<StoredShoppingListItem>
    >(async () => storedItem({ quantity: 3 }));
    const fixture = makeContext(makeListStorage({ updateItem }));
    registerShoppingListTools(fixture.server, fixture);

    const result = await getCapturedHandler("update_shopping_list")({
      listId: "list-a",
      change: [{ itemId: "item-1", quantity: 3 }],
    });

    expect(result.isError).toBe(false);
    expect(updateItem).toHaveBeenCalledWith("list-a", "item-1", {
      quantity: 3,
    });
  });

  it("checks an item off without deleting it", async () => {
    const updateItem = vi.fn<
      (
        listId: string,
        itemId: string,
        patch: ShoppingListItemPatch,
      ) => Promise<StoredShoppingListItem>
    >(async () => storedItem({ checked: true }));
    const removeItem = vi.fn<(listId: string, itemId: string) => Promise<void>>(
      async () => {},
    );
    const fixture = makeContext(makeListStorage({ updateItem, removeItem }));
    registerShoppingListTools(fixture.server, fixture);

    const result = await getCapturedHandler("update_shopping_list")({
      listId: "list-a",
      change: [{ itemId: "item-1", checked: true }],
    });

    expect(updateItem).toHaveBeenCalledWith("list-a", "item-1", {
      checked: true,
    });
    expect(removeItem).not.toHaveBeenCalled();
    expect(result.text).toContain("checked off");
  });

  it("deletes removed items without also patching them", async () => {
    const updateItem = vi.fn<
      (
        listId: string,
        itemId: string,
        patch: ShoppingListItemPatch,
      ) => Promise<StoredShoppingListItem>
    >(async () => storedItem());
    const removeItem = vi.fn<(listId: string, itemId: string) => Promise<void>>(
      async () => {},
    );
    const fixture = makeContext(
      makeListStorage({ updateItem, removeItem, get: listWith(storedItem()) }),
    );
    registerShoppingListTools(fixture.server, fixture);

    const result = await getCapturedHandler("update_shopping_list")({
      listId: "list-a",
      remove: ["item-1"],
    });

    expect(removeItem).toHaveBeenCalledWith("list-a", "item-1");
    expect(updateItem).not.toHaveBeenCalled();
    expect(result.text).toContain("Removed itemId=item-1");
  });

  it("asks for a field rather than silently doing nothing", async () => {
    const fixture = makeContext(makeListStorage({}));
    registerShoppingListTools(fixture.server, fixture);

    const result = await getCapturedHandler("update_shopping_list")({
      listId: "list-a",
      change: [{ itemId: "item-1" }],
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("needs productName, quantity");
  });

  it("applies a whole edit in one call: remove, change, then add", async () => {
    const calls: string[] = [];
    const storage = makeListStorage({
      get: listWith(storedItem({ id: "cheese", productName: "Cheddar" })),
      removeItem: async (_listId, itemId) => {
        calls.push(`remove ${itemId}`);
      },
      updateItem: async (_listId, itemId, patch) => {
        calls.push(`change ${itemId}`);
        return storedItem({ id: itemId, ...patch });
      },
      addItems: async (_listId, items) => {
        calls.push(`add ${items.length}`);
        return items.map((item) => ({ ...item, checked: false, id: "new-1" }));
      },
    });
    const fixture = makeContext(storage);
    registerShoppingListTools(fixture.server, fixture);

    const result = await getCapturedHandler("update_shopping_list")({
      listId: "list-a",
      add: [{ productName: "Eggs" }],
      change: [
        { itemId: "milk", quantity: 2 },
        { itemId: "bread", checked: true },
      ],
      remove: ["cheese"],
    });

    expect(result.isError).toBe(false);
    expect(calls).toEqual([
      "remove cheese",
      "change milk",
      "change bread",
      "add 1",
    ]);
    expect(result.text).toContain("Removed itemId=cheese");
    expect(result.text).toContain("checked off");
    expect(result.text).toContain("Added itemId=new-1");
  });

  it("reports edits already applied when a later one fails", async () => {
    const storage = makeListStorage({
      get: listWith(storedItem({ id: "cheese", productName: "Cheddar" })),
      removeItem: async () => {},
      updateItem: async () => {
        throw new Error("row locked");
      },
    });
    const fixture = makeContext(storage);
    registerShoppingListTools(fixture.server, fixture);

    const result = await getCapturedHandler("update_shopping_list")({
      listId: "list-a",
      change: [{ itemId: "milk", quantity: 2 }],
      remove: ["cheese"],
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("Already applied");
    expect(result.text).toContain("Removed itemId=cheese");
  });

  it("removes by item name or quantity 0, as models often send", async () => {
    const removeItem = vi.fn<(listId: string, itemId: string) => Promise<void>>(
      async () => {},
    );
    const fixture = makeContext(
      makeListStorage({
        removeItem,
        get: listWith(
          storedItem({ id: "item-c", productName: "Kroger Cheddar Block" }),
          storedItem({ id: "item-m", productName: "Milk" }),
        ),
      }),
    );
    registerShoppingListTools(fixture.server, fixture);

    const result = await getCapturedHandler("update_shopping_list")({
      listId: "list-a",
      remove: ["kroger cheddar block"],
      change: [{ itemId: "item-m", quantity: 0 }],
    });

    expect(result.isError).toBe(false);
    expect(removeItem.mock.calls).toEqual([
      ["list-a", "item-c"],
      ["list-a", "item-m"],
    ]);
  });

  it("changes nothing when a removal names an unknown item", async () => {
    const removeItem = vi.fn<(listId: string, itemId: string) => Promise<void>>(
      async () => {},
    );
    const fixture = makeContext(
      makeListStorage({ removeItem, get: listWith(storedItem()) }),
    );
    registerShoppingListTools(fixture.server, fixture);

    const result = await getCapturedHandler("update_shopping_list")({
      listId: "list-a",
      remove: ["item-1", "Caviar"],
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain('No item "Caviar"');
    expect(result.text).toContain("itemId=item-1 Milk");
    expect(removeItem).not.toHaveBeenCalled();
  });
});

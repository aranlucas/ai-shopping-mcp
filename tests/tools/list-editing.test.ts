/**
 * Covers the human-editable list surface: reading lists and their item ids,
 * appending plain ingredients without a Kroger UPC, editing one item, and
 * deleting one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolContext } from "../../src/tools/types.js";
import type {
  ShoppingListItem,
  StoredShoppingListItem,
  ShoppingListItemPatch,
} from "../../src/domain/shopping.js";

import { registerShoppingListTools } from "../../src/tools/shopping-list.js";
import {
  getCapturedHandler,
  getCapturedTool,
  makeContext,
  makeStorage,
  resetToolTestHarness,
} from "./tool-test-harness.js";

type ListStore = ToolContext["storage"]["shoppingList"];

function makeListStorage(overrides: Partial<ListStore>) {
  const storage = makeStorage();
  storage.shoppingList = { ...storage.shoppingList, ...overrides } as ListStore;
  return storage;
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
    registerShoppingListTools(makeContext(storage));

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
    registerShoppingListTools(makeContext(storage));

    const result = await getCapturedHandler("get_shopping_list")({
      listId: "list-a",
    });

    expect(result.text).toContain("itemId=item-7");
    expect(result.text).toContain("Chili Onion Crunch");
  });

  it("points at the index when the listId does not exist", async () => {
    const storage = makeListStorage({ get: async () => null });
    registerShoppingListTools(makeContext(storage));

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
    registerShoppingListTools(makeContext(makeListStorage({ addItems })));

    const result = await getCapturedHandler("add_shopping_list_items")({
      listId: "list-a",
      items: [{ productName: "Chili Onion Crunch", notes: "Sample Catalog" }],
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
      enrichProductName: async () => "Whole Milk",
    } as unknown as ToolContext["productService"];
    registerShoppingListTools(ctx);

    await getCapturedHandler("add_shopping_list_items")({
      listId: "list-a",
      items: [{ upc: "0001111042578", quantity: 2 }],
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
    registerShoppingListTools(makeContext());
    const { config } = getCapturedTool("add_shopping_list_items");
    const { inputSchema } = config as {
      inputSchema: { safeParse: (input: unknown) => { success: boolean } };
    };

    expect(
      inputSchema.safeParse({ listId: "list-a", items: [{ quantity: 1 }] })
        .success,
    ).toBe(false);
  });

  it("rejects productRef instead of UPC", () => {
    registerShoppingListTools(makeContext());
    const { config } = getCapturedTool("add_shopping_list_items");
    const { inputSchema } = config as {
      inputSchema: { safeParse: (input: unknown) => { success: boolean } };
    };

    expect(
      inputSchema.safeParse({
        listId: "list-a",
        items: [{ productRef: "kroger:1", productName: "Milk" }],
      }).success,
    ).toBe(false);
  });

  it("edits only the fields it is given", async () => {
    const updateItem = vi.fn<
      (
        listId: string,
        itemId: string,
        patch: ShoppingListItemPatch,
      ) => Promise<StoredShoppingListItem>
    >(async () => storedItem({ quantity: 3 }));
    registerShoppingListTools(makeContext(makeListStorage({ updateItem })));

    const result = await getCapturedHandler("edit_shopping_list_item")({
      listId: "list-a",
      itemId: "item-1",
      quantity: 3,
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
    registerShoppingListTools(
      makeContext(makeListStorage({ updateItem, removeItem })),
    );

    const result = await getCapturedHandler("edit_shopping_list_item")({
      listId: "list-a",
      itemId: "item-1",
      checked: true,
    });

    expect(updateItem).toHaveBeenCalledWith("list-a", "item-1", {
      checked: true,
    });
    expect(removeItem).not.toHaveBeenCalled();
    expect(result.text).toContain("checked off");
  });

  it("deletes the item when remove is set, without also patching it", async () => {
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
    registerShoppingListTools(
      makeContext(makeListStorage({ updateItem, removeItem })),
    );

    const result = await getCapturedHandler("edit_shopping_list_item")({
      listId: "list-a",
      itemId: "item-1",
      remove: true,
    });

    expect(removeItem).toHaveBeenCalledWith("list-a", "item-1");
    expect(updateItem).not.toHaveBeenCalled();
    expect(result.text).toContain("Removed itemId=item-1");
  });

  it("asks for a field rather than silently doing nothing", async () => {
    registerShoppingListTools(makeContext(makeListStorage({})));

    const result = await getCapturedHandler("edit_shopping_list_item")({
      listId: "list-a",
      itemId: "item-1",
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("remove=true");
  });
});

import type { App } from "@modelcontextprotocol/ext-apps/react";

import { describe, expect, it } from "vitest";

import type { ToolCall } from "../../views/shared/types.js";

import {
  addProductToCart,
  addShoppingListToCartCall,
  createProductShoppingListCall,
  saveProductToList,
  shoppingListIdFromResult,
  toolResultErrorMessage,
} from "../../views/app/tool-calls.js";

function makeToolCallingApp(results: Array<{ isError?: true; structuredContent?: unknown }>) {
  const calls: ToolCall[] = [];
  const app = {
    callServerTool: async (call: unknown) => {
      calls.push(call as ToolCall);
      return { content: [], ...results.shift() };
    },
  } as unknown as App;

  return { app, calls };
}

describe("view tool call helpers", () => {
  it("creates a create_shopping_list call for a selected product", () => {
    expect(
      createProductShoppingListCall({
        productName: "Whole Milk",
        quantity: 2,
        upc: "0001111041700",
      }),
    ).toEqual({
      name: "create_shopping_list",
      arguments: {
        name: "Whole Milk",
        items: [{ productName: "Whole Milk", quantity: 2, upc: "0001111041700" }],
      },
    });
  });

  it("creates an add_shopping_list_to_cart call using shopping_list_id", () => {
    expect(addShoppingListToCartCall("user-123:session:s1:list:abc12345")).toEqual({
      name: "add_shopping_list_to_cart",
      arguments: {
        shopping_list_id: "user-123:session:s1:list:abc12345",
        modality: "PICKUP",
      },
    });
  });

  it("reads shopping_list_id from create_shopping_list structured content", () => {
    expect(
      shoppingListIdFromResult({
        content: [],
        structuredContent: { shopping_list_id: "list-123" },
      }),
    ).toBe("list-123");
  });

  it("throws when create_shopping_list did not return a shopping_list_id", () => {
    expect(() => shoppingListIdFromResult({ content: [], structuredContent: {} })).toThrow(
      "Shopping list id missing",
    );
  });

  it("formats text content from errored tool results", () => {
    expect(
      toolResultErrorMessage(
        {
          content: [{ type: "text", text: "No shopping list found" }],
          isError: true,
        },
        "Fallback",
      ),
    ).toBe("No shopping list found");
  });

  it("adds a selected product to cart through a shopping_list_id", async () => {
    const { app, calls } = makeToolCallingApp([
      { structuredContent: { shopping_list_id: "user-123:session:s1:list:abc12345" } },
      {},
    ]);

    await addProductToCart(app, {
      listName: "Cart: Whole Milk",
      productName: "Whole Milk",
      quantity: 2,
      upc: "0001111041700",
    });

    expect(calls).toEqual([
      {
        name: "create_shopping_list",
        arguments: {
          name: "Cart: Whole Milk",
          items: [{ productName: "Whole Milk", quantity: 2, upc: "0001111041700" }],
        },
      },
      {
        name: "add_shopping_list_to_cart",
        arguments: {
          shopping_list_id: "user-123:session:s1:list:abc12345",
          modality: "PICKUP",
        },
      },
    ]);
  });

  it("saves a selected product by creating a shopping list without cart checkout", async () => {
    const { app, calls } = makeToolCallingApp([
      { structuredContent: { shopping_list_id: "user-123:session:s1:list:def67890" } },
    ]);

    await saveProductToList(app, {
      productName: "Sourdough Bread",
      quantity: 1,
      upc: "0001111041717",
    });

    expect(calls).toEqual([
      {
        name: "create_shopping_list",
        arguments: {
          name: "Sourdough Bread",
          items: [{ productName: "Sourdough Bread", quantity: 1, upc: "0001111041717" }],
        },
      },
    ]);
  });

  it("fails list saves when create_shopping_list does not return a shopping_list_id", async () => {
    const { app } = makeToolCallingApp([{ structuredContent: {} }]);

    await expect(
      saveProductToList(app, {
        productName: "Sourdough Bread",
        quantity: 1,
        upc: "0001111041717",
      }),
    ).rejects.toThrow("Shopping list id missing");
  });
});

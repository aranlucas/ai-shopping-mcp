import type { App } from "@modelcontextprotocol/ext-apps/react";

import { describe, expect, it, vi } from "vitest";

import { type ToolCall, callTool, sendUserMessage } from "../../views/shared/types.js";

import {
  addProductToCart,
  addShoppingListToCartCall,
  createProductShoppingListCall,
  saveProductToList,
  shoppingListIdFromResult,
  toolResultErrorMessage,
} from "../../views/app/tool-calls.js";

function makeToolCallingApp(
  results: Array<{ isError?: true; structuredContent?: Record<string, unknown> }>,
) {
  const calls: ToolCall[] = [];
  const callServerTool = vi.fn<App["callServerTool"]>(async (call) => {
    calls.push(call as ToolCall);
    return { content: [], ...results.shift() };
  });
  const app = { callServerTool } as unknown as App;

  return { app, calls };
}

function makeMessageApp(result: Awaited<ReturnType<App["sendMessage"]>>) {
  const sendMessage = vi.fn<App["sendMessage"]>().mockResolvedValue(result);
  return { app: { sendMessage } as unknown as App, sendMessage };
}

describe("view tool call helpers", () => {
  it("rejects server-tool writes when the app is disconnected", async () => {
    await expect(callTool(null, addShoppingListToCartCall("list_abc12345"))).rejects.toThrow(
      "shopping app is disconnected",
    );
  });

  it("rejects user messages when the app is disconnected", async () => {
    await expect(sendUserMessage(null, "Find milk")).rejects.toThrow(
      "shopping app is disconnected",
    );
  });

  it("rejects user messages when the host returns an error result", async () => {
    const { app, sendMessage } = makeMessageApp({ isError: true });

    await expect(sendUserMessage(app, "Find milk")).rejects.toThrow(
      "assistant could not receive your request",
    );
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("preserves a rejected host message", async () => {
    const hostError = new Error("host disconnected");
    const sendMessage = vi.fn<App["sendMessage"]>().mockRejectedValue(hostError);
    const app = { sendMessage } as unknown as App;

    await expect(sendUserMessage(app, "Find milk")).rejects.toBe(hostError);
  });

  it("creates a create_shopping_list call for a selected product", () => {
    expect(
      createProductShoppingListCall({
        productName: "Whole Milk",
        quantity: 2,
        productRef: "kroger:0001111041700",
      }),
    ).toEqual({
      name: "create_shopping_list",
      arguments: {
        name: "Whole Milk",
        items: [
          {
            productName: "Whole Milk",
            productRef: "kroger:0001111041700",
            quantity: 2,
          },
        ],
      },
    });
  });

  it("creates an add_shopping_list_to_cart call using listId", () => {
    expect(addShoppingListToCartCall("list_abc12345")).toEqual({
      name: "add_shopping_list_to_cart",
      arguments: {
        listId: "list_abc12345",
        modality: "PICKUP",
      },
    });
  });

  it("reads listId from create_shopping_list structured content", () => {
    expect(
      shoppingListIdFromResult({
        content: [],
        structuredContent: { listId: "list-123" },
      }),
    ).toBe("list-123");
  });

  it("throws when create_shopping_list did not return a listId", () => {
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

  it("adds a selected product to cart through a listId", async () => {
    const { app, calls } = makeToolCallingApp([
      { structuredContent: { listId: "list_abc12345" } },
      {},
    ]);

    await addProductToCart(app, {
      listName: "Cart: Whole Milk",
      productName: "Whole Milk",
      quantity: 2,
      productRef: "kroger:0001111041700",
    });

    expect(calls).toEqual([
      {
        name: "create_shopping_list",
        arguments: {
          name: "Cart: Whole Milk",
          items: [
            {
              productName: "Whole Milk",
              productRef: "kroger:0001111041700",
              quantity: 2,
            },
          ],
        },
      },
      {
        name: "add_shopping_list_to_cart",
        arguments: {
          listId: "list_abc12345",
          modality: "PICKUP",
        },
      },
    ]);
  });

  it("saves a selected product by creating a shopping list without cart checkout", async () => {
    const { app, calls } = makeToolCallingApp([{ structuredContent: { listId: "list_def67890" } }]);

    await saveProductToList(app, {
      productName: "Sourdough Bread",
      quantity: 1,
      productRef: "kroger:0001111041717",
    });

    expect(calls).toEqual([
      {
        name: "create_shopping_list",
        arguments: {
          name: "Sourdough Bread",
          items: [
            {
              productName: "Sourdough Bread",
              productRef: "kroger:0001111041717",
              quantity: 1,
            },
          ],
        },
      },
    ]);
  });

  it("fails list saves when create_shopping_list does not return a listId", async () => {
    const { app } = makeToolCallingApp([{ structuredContent: {} }]);

    await expect(
      saveProductToList(app, {
        productName: "Sourdough Bread",
        quantity: 1,
        productRef: "kroger:0001111041717",
      }),
    ).rejects.toThrow("Shopping list id missing");
  });
});

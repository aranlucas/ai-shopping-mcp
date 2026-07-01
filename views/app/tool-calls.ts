import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { type AddShoppingListToCartArgs, type ToolCall, callTool } from "../shared/types.js";

type ProductShoppingListInput = {
  listName?: string;
  productName: string;
  quantity: number;
  upc: string;
};

type ProductCartInput = ProductShoppingListInput & {
  modality?: AddShoppingListToCartArgs["modality"];
};

type CreateShoppingListCall = Extract<ToolCall, { name: "create_shopping_list" }>;
type AddShoppingListToCartCall = Extract<ToolCall, { name: "add_shopping_list_to_cart" }>;

export function createProductShoppingListCall({
  listName,
  productName,
  quantity,
  upc,
}: ProductShoppingListInput): CreateShoppingListCall {
  return {
    name: "create_shopping_list",
    arguments: {
      name: listName ?? productName,
      items: [{ productName, upc, quantity }],
    },
  };
}

export function addShoppingListToCartCall(
  shoppingListId: string,
  modality: AddShoppingListToCartArgs["modality"] = "PICKUP",
): AddShoppingListToCartCall {
  return {
    name: "add_shopping_list_to_cart",
    arguments: {
      shopping_list_id: shoppingListId,
      modality,
    },
  };
}

export function shoppingListIdFromResult(result: CallToolResult | undefined): string {
  const structuredContent = result?.structuredContent;
  if (!structuredContent || typeof structuredContent !== "object") {
    throw new Error("Shopping list id missing");
  }

  const id = (structuredContent as { shopping_list_id?: unknown }).shopping_list_id;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("Shopping list id missing");
  }

  return id;
}

export function toolResultErrorMessage(
  result: CallToolResult | undefined,
  fallback: string,
): string {
  return (
    result?.content
      ?.map((content) => ("text" in content ? content.text : ""))
      .filter(Boolean)
      .join(" ") || fallback
  );
}

export async function saveProductToList(
  app: Parameters<typeof callTool>[0],
  input: ProductShoppingListInput,
): Promise<void> {
  const result = await callTool(app, createProductShoppingListCall(input));
  if (result?.isError) {
    throw new Error(toolResultErrorMessage(result, "Failed to create shopping list"));
  }
  shoppingListIdFromResult(result);
}

export async function addProductToCart(
  app: Parameters<typeof callTool>[0],
  { modality = "PICKUP", ...input }: ProductCartInput,
): Promise<void> {
  const listResult = await callTool(app, createProductShoppingListCall(input));
  if (listResult?.isError) {
    throw new Error(toolResultErrorMessage(listResult, "Failed to create shopping list"));
  }
  const shoppingListId = shoppingListIdFromResult(listResult);

  const result = await callTool(app, addShoppingListToCartCall(shoppingListId, modality));
  if (result?.isError) {
    throw new Error(toolResultErrorMessage(result, "Failed to add to cart"));
  }
}

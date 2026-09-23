import type { CallToolResult } from "@modelcontextprotocol/client";
import {
  type AddShoppingListToCartContent,
  type AddShoppingListToCartArgs,
  type ToolCall,
  callTool,
  parseToolResult,
} from "../shared/types.js";

export type ProductShoppingListInput = {
  listName?: string;
  productName: string;
  quantity: number;
  upc: string;
};

export class CartActionError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly recovery?: string,
  ) {
    super(message);
    this.name = "CartActionError";
  }
}

export function cartResultError(result: CallToolResult): CartActionError {
  const content = result.structuredContent;
  const error =
    content && typeof content === "object" && "error" in content
      ? content.error
      : undefined;
  const detail =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  return new CartActionError(
    toolResultErrorMessage(result, "Failed to add to cart"),
    typeof detail.code === "string" ? detail.code : undefined,
    typeof detail.recovery === "string" ? detail.recovery : undefined,
  );
}

export function needsCartCheck(error: unknown): boolean {
  return (
    error instanceof CartActionError &&
    error.recovery !== "check_list" &&
    (error.code === "MUTATION_OUTCOME_UNKNOWN" ||
      error.recovery === "check_cart")
  );
}

export function needsListCheck(error: unknown): boolean {
  return error instanceof CartActionError && error.recovery === "check_list";
}

/** Validate the structured cart payload before a UI state transition. */
export function cartResultContent(
  result: CallToolResult,
): AddShoppingListToCartContent {
  const data = parseToolResult(result);
  if (!data || data.view !== "add_shopping_list_to_cart") {
    throw new CartActionError(
      "The cart response was malformed. Check your Kroger cart before retrying.",
      "MALFORMED_CART_RESULT",
      "check_cart",
    );
  }
  return data;
}

type CreateShoppingListCall = Extract<
  ToolCall,
  { name: "create_shopping_list" }
>;
type AddShoppingListToCartCall = Extract<
  ToolCall,
  { name: "add_shopping_list_to_cart" }
>;

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
      items: [{ upc, productName, quantity }],
    },
  };
}

export function addShoppingListToCartCall(
  listId: string,
  modality: AddShoppingListToCartArgs["modality"] = "PICKUP",
): AddShoppingListToCartCall {
  return {
    name: "add_shopping_list_to_cart",
    arguments: {
      listId,
      modality,
    },
  };
}

export function shoppingListIdFromResult(
  result: CallToolResult | undefined,
): string {
  const structuredContent = result?.structuredContent;
  if (!structuredContent || typeof structuredContent !== "object") {
    throw new Error("Shopping list id missing");
  }

  const id = (structuredContent as { listId?: unknown }).listId;
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

export async function createProductList(
  app: Parameters<typeof callTool>[0],
  input: ProductShoppingListInput,
): Promise<string> {
  if (!app)
    throw new Error(
      "The shopping app is disconnected. Reopen it and try again.",
    );

  let result: CallToolResult;
  try {
    result = await callTool(app, createProductShoppingListCall(input));
  } catch {
    throw new CartActionError(
      "The shopping list response was lost. Check your Kroger saved lists before trying again.",
      "MUTATION_OUTCOME_UNKNOWN",
      "check_list",
    );
  }

  if (result?.isError) {
    throw new Error(
      toolResultErrorMessage(result, "Failed to create shopping list"),
    );
  }

  try {
    return shoppingListIdFromResult(result);
  } catch {
    throw new CartActionError(
      "Shopping list creation could not be confirmed. Check your Kroger saved lists before trying again.",
      "MUTATION_OUTCOME_UNKNOWN",
      "check_list",
    );
  }
}

export async function saveProductToList(
  app: Parameters<typeof callTool>[0],
  input: ProductShoppingListInput,
): Promise<void> {
  await createProductList(app, input);
}

/** Shared error semantics for product and saved-list cart actions. */
export async function addListToCart(
  app: Parameters<typeof callTool>[0],
  listId: string,
  modality: AddShoppingListToCartArgs["modality"] = "PICKUP",
): Promise<AddShoppingListToCartContent> {
  if (!app)
    throw new Error(
      "The shopping app is disconnected. Reopen it and try again.",
    );
  let result: CallToolResult;
  try {
    result = await callTool(app, addShoppingListToCartCall(listId, modality));
  } catch {
    throw new CartActionError(
      "Cart confirmation was lost. Check your Kroger cart before adding again.",
      "MUTATION_OUTCOME_UNKNOWN",
      "check_cart",
    );
  }
  if (result?.isError) {
    throw cartResultError(result);
  }
  return cartResultContent(result);
}

import { z } from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/client";
import {
  type AddShoppingListToCartContent,
  type AddShoppingListToCartArgs,
  type AppData,
  type ShoppingListContent,
  type ShoppingListItemData,
  type ShoppingListSummaryData,
  type ToolCall,
  callTool,
  parseToolResult,
} from "../shared/types.js";

export type ProductShoppingListInput = {
  listName?: string;
  productName: string;
  quantity: number;
  upc: string;
  price?: number;
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
  const parsed = z
    .object({
      error: z.object({
        code: z.string().optional().catch(undefined),
        recovery: z.string().optional().catch(undefined),
      }),
    })
    .safeParse(result.structuredContent);

  const detail = parsed.success ? parsed.data.error : undefined;

  return new CartActionError(
    toolResultErrorMessage(result, "Failed to add to cart"),
    detail?.code,
    detail?.recovery,
  );
}

export function needsCartCheck(cause: unknown): boolean {
  return (
    cause instanceof CartActionError &&
    cause.recovery !== "check_list" &&
    (cause.code === "MUTATION_OUTCOME_UNKNOWN" || cause.recovery === "check_cart")
  );
}

export function needsListCheck(cause: unknown): boolean {
  return cause instanceof CartActionError && cause.recovery === "check_list";
}

export function cartResultContent(result: CallToolResult): AddShoppingListToCartContent {
  const data = parseToolResult(result);

  if (data?.view !== "add_shopping_list_to_cart") {
    throw new CartActionError(
      "The cart response was malformed. Check your Kroger cart before retrying.",
      "MALFORMED_CART_RESULT",
      "check_cart",
    );
  }

  return data;
}

type CreateShoppingListCall = Extract<ToolCall, { name: "create_shopping_list" }>;

type AddShoppingListToCartCall = Extract<ToolCall, { name: "add_shopping_list_to_cart" }>;

export function createProductShoppingListCall({
  listName,
  productName,
  quantity,
  upc,
  price,
}: ProductShoppingListInput): CreateShoppingListCall {
  return {
    name: "create_shopping_list",
    arguments: {
      name: listName ?? productName,
      items: [{ upc, productName, quantity, price }],
    },
  };
}

export function addShoppingListToCartCall(
  listId: string,
  modality: AddShoppingListToCartArgs["modality"] = "PICKUP",
  storeId?: string,
): AddShoppingListToCartCall {
  const call: AddShoppingListToCartCall = {
    name: "add_shopping_list_to_cart",
    arguments: {
      listId,
      modality,
    },
  };

  if (storeId) {
    call.arguments.storeId = storeId;
  }

  return call;
}

export function shoppingListIdFromResult(result: CallToolResult | undefined): string {
  const parsed = z.object({ listId: z.string().min(1) }).safeParse(result?.structuredContent);

  if (!parsed.success) {
    throw new Error("Shopping list id missing");
  }

  return parsed.data.listId;
}

export function toolResultErrorMessage(
  result: CallToolResult | undefined,
  fallback: string,
): string {
  const message = result?.content
    ?.map((content) => ("text" in content ? content.text : ""))
    .filter(Boolean)
    .join(" ");

  return message?.length ? message : fallback;
}

export async function createProductList(
  app: Parameters<typeof callTool>[0],
  input: ProductShoppingListInput,
): Promise<string> {
  if (!app) {
    throw new Error("The shopping app is disconnected. Reopen it and try again.");
  }

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
    throw new Error(toolResultErrorMessage(result, "Failed to create shopping list"));
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
  listId?: string,
): Promise<void> {
  if (!listId) {
    await createProductList(app, input);

    return;
  }

  await callForView(
    app,
    {
      name: "update_shopping_list",
      arguments: {
        listId,
        add: [
          {
            upc: input.upc,
            productName: input.productName,
            quantity: input.quantity,
            price: input.price,
          },
        ],
      },
    },
    "Failed to save to list",
  );
}

export async function callForView(
  app: Parameters<typeof callTool>[0],
  call: ToolCall,
  fallback: string,
): Promise<AppData> {
  const result = await callTool(app, call);

  if (result.isError) {
    throw new Error(toolResultErrorMessage(result, fallback));
  }

  const data = parseToolResult(result);

  if (!data) {
    throw new Error(fallback);
  }

  return data;
}

export async function loadShoppingLists(
  app: Parameters<typeof callTool>[0],
): Promise<ShoppingListSummaryData[]> {
  const data = await callForView(
    app,
    { name: "get_shopping_list", arguments: {} },
    "Could not load your lists",
  );

  return data.view === "shopping_lists" ? data.lists : [];
}

/** Deletes one saved list and returns the lists that remain. */
export async function deleteShoppingList(
  app: Parameters<typeof callTool>[0],
  listId: string,
): Promise<ShoppingListSummaryData[]> {
  const result = await callTool(app, { name: "delete_shopping_list", arguments: { listId } });

  if (result.isError) {
    throw new Error(toolResultErrorMessage(result, "Could not delete that list"));
  }

  const data = parseToolResult(result);

  // A successful delete without a lists view means only the re-read failed.
  if (data?.view !== "shopping_lists") {
    throw new Error("The list was deleted, but your lists could not be reloaded. Reopen them.");
  }

  return data.lists;
}

export async function openShoppingList(
  app: Parameters<typeof callTool>[0],
  listId: string,
): Promise<ShoppingListContent> {
  const data = await callForView(
    app,
    { name: "get_shopping_list", arguments: { listId } },
    "Could not open that list",
  );

  if (data.view !== "create_shopping_list") {
    throw new Error("Could not open that list");
  }

  return data;
}

export type ShoppingListItemEdit = {
  listId: string;
  itemId: string;
  productName?: string;
  quantity?: number;
  notes?: string;
  checked?: boolean;
  remove?: boolean;
};

export async function editShoppingListItem(
  app: Parameters<typeof callTool>[0],
  { listId, itemId, remove, ...change }: ShoppingListItemEdit,
): Promise<ShoppingListContent> {
  const data = await callForView(
    app,
    {
      name: "update_shopping_list",
      arguments: remove
        ? { listId, remove: [itemId] }
        : { listId, change: [{ itemId, ...change }] },
    },
    "Could not update the list",
  );

  if (data.view !== "create_shopping_list") {
    throw new Error("Could not update the list");
  }

  return data;
}

export async function recordPurchase(
  app: Parameters<typeof callTool>[0],
  items: ShoppingListItemData[],
): Promise<void> {
  const purchased = items.flatMap((item) =>
    item.upc
      ? [
          {
            upc: item.upc,
            productName: item.productName,
            quantity: Math.max(1, Math.round(item.quantity)),
            price: item.price,
          },
        ]
      : [],
  );

  if (purchased.length === 0) {
    throw new Error("No Kroger items to record as purchased");
  }

  await callForView(
    app,
    { name: "record_order", arguments: { items: purchased } },
    "Could not record the purchase",
  );
}

export async function addListToCart(
  app: Parameters<typeof callTool>[0],
  listId: string,
  modality: AddShoppingListToCartArgs["modality"] = "PICKUP",
  storeId?: string,
): Promise<AddShoppingListToCartContent> {
  if (!app) {
    throw new Error("The shopping app is disconnected. Reopen it and try again.");
  }

  let result: CallToolResult;

  try {
    result = await callTool(app, addShoppingListToCartCall(listId, modality, storeId));
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

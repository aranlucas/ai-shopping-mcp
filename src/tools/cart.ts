import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { err, ok } from "neverthrow";
import * as z from "zod/v4";

import type { AppError } from "../errors.js";
import type { components } from "../services/kroger/cart.js";

import { appResult } from "../app-results.js";
import type { KrogerClients } from "../services/kroger/client.js";
import type { CartSnapshotItem, ShoppingListItem } from "../utils/user-storage.js";

import { storageError, validationError } from "../errors.js";
import {
  fromApiResponse,
  getProps,
  safeResolveLocationId,
  safeStorage,
  toMcpError,
} from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { modalityEnum, storeIdSchema, upcSchema } from "./schemas.js";
import { requestCheckoutConfirmation } from "./shopping-list.js";
import { type ToolContext, textResult } from "./types.js";

type CartItem = components["schemas"]["cart.cartItemModel"];
type CartItemRequest = components["schemas"]["cart.cartItemRequestModel"];
type LiveCart = components["schemas"]["carts.cartModel"];

export type LineItem = { upc: string; quantity: number; productName?: string };

const inlineCartItemSchema = z.object({
  upc: upcSchema.describe("UPC from search_products"),
  quantity: z.coerce.number().min(1).max(999).default(1),
});

export const addShoppingListToCartInputSchema = z
  .object({
    listId: z.string().min(1).optional().describe("Short listId returned by create_shopping_list"),
    items: z
      .array(inlineCartItemSchema)
      .min(1)
      .max(10)
      .optional()
      .describe("Inline upc/quantity items to add directly, instead of a listId"),
    storeId: storeIdSchema
      .optional()
      .describe("8-character storeId from search_stores. Uses your preferred store if omitted."),
    modality: modalityEnum.default("PICKUP"),
  })
  .refine((value) => Boolean(value.listId) !== Boolean(value.items), {
    message:
      "Provide exactly one of listId (from create_shopping_list) or items (inline upc/quantity pairs) — not both, not neither.",
  });

export function toCartSnapshotItems(
  lineItems: LineItem[],
  modality: "PICKUP" | "DELIVERY",
): CartSnapshotItem[] {
  return lineItems.map((item) => ({
    upc: item.upc,
    quantity: item.quantity,
    modality,
    productName: item.productName,
  }));
}

/**
 * Confirms with the user (via elicitation) and PUTs the given line items to
 * the Kroger cart. Shared by every cart-write path (listId, inline items, and
 * `shop_for_items`'s `addToCart`) so the confirm → PUT → mirror-append logic
 * lives in one place. On success, also appends to the per-user cart mirror
 * (`ctx.storage.cartMirror`) that `view_cart` reads — best-effort, a mirror
 * write failure does not fail the tool call.
 */
export async function addLineItemsToCart(
  ctx: ToolContext,
  cartClient: KrogerClients["cartClient"],
  lineItems: LineItem[],
  modality: "PICKUP" | "DELIVERY",
) {
  const confirmation = await requestCheckoutConfirmation(
    ctx.server.server,
    lineItems.map((item) => ({
      productName: item.productName ?? item.upc,
      quantity: item.quantity,
    })),
  );
  if (confirmation.isErr()) return err<void, AppError>(confirmation.error);

  const cartItems: CartItem[] = lineItems.map((item) => ({
    upc: item.upc,
    quantity: item.quantity,
    modality,
  }));
  const requestBody: CartItemRequest = { items: cartItems };

  const addResult = await fromApiResponse(
    cartClient.PUT("/v1/cart/add", {
      body: requestBody,
      headers: { "Content-Type": "application/json" },
    }),
    "add items to cart",
  );

  if (addResult.isErr()) return err<void, AppError>(addResult.error);

  const mirrorItems = toCartSnapshotItems(lineItems, modality);

  await safeStorage(
    () => ctx.storage.cartMirror.append(mirrorItems, new Date().toISOString()),
    "append cart mirror",
  ).orTee((e) => console.warn("Cart mirror append failed (non-fatal):", e.message));

  return ok(undefined);
}

async function handleInlineItemsCart(
  ctx: ToolContext,
  cartClient: KrogerClients["cartClient"],
  items: Array<{ upc: string; quantity: number }>,
  storeId: string | undefined,
  modality: "PICKUP" | "DELIVERY",
) {
  const locationResult = await safeResolveLocationId(ctx.storage, storeId);
  if (locationResult.isErr()) return toMcpError(locationResult.error);

  const addResult = await addLineItemsToCart(ctx, cartClient, items, modality);
  if (addResult.isErr()) return toMcpError(addResult.error);

  const resolved = locationResult.value;
  const locationInfo = resolved.locationName
    ? ` at ${resolved.locationName}`
    : ` (Store: ${resolved.locationId})`;

  return {
    content: [
      {
        type: "text" as const,
        text: `Added ${items.length} item(s) to cart${locationInfo}:\n${items.map((i) => `  - ${i.upc} x${i.quantity}`).join("\n")}`,
      },
    ],
    ...appResult("add_shopping_list_to_cart", {
      listId: undefined,
      name: "Inline items",
      items: items.map((i) => ({ upc: i.upc, quantity: i.quantity, modality })),
      needsUpc: [],
      actionDetail: `Added ${items.length} item(s) to cart`,
    }),
  };
}

async function handleListIdCart(
  ctx: ToolContext,
  cartClient: KrogerClients["cartClient"],
  listId: string,
  storeId: string | undefined,
  modality: "PICKUP" | "DELIVERY",
) {
  const existingSnapshotResult = await safeStorage(
    () => ctx.storage.cartSnapshot.get(listId),
    "check existing cart snapshot",
  );

  if (existingSnapshotResult.isErr()) return toMcpError(existingSnapshotResult.error);
  const existingSnapshot = existingSnapshotResult.value;

  if (existingSnapshot && existingSnapshot.length > 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: "These items were already added to your cart from this list. Create a new list with create_shopping_list if you want to add more.",
        },
      ],
      ...appResult("add_shopping_list_to_cart", {
        listId,
        name: "",
        items: existingSnapshot,
        needsUpc: [],
        actionDetail: "Already added to cart from this list",
      }),
    };
  }

  const listResult = await safeStorage(
    () => ctx.storage.shoppingList.get(listId),
    "fetch shopping list",
  );
  if (listResult.isErr()) return toMcpError(listResult.error);
  const list = listResult.value;
  if (!list) {
    return toMcpError(
      validationError(
        `No shopping list found for listId "${listId}". Create one with create_shopping_list first.`,
      ),
    );
  }

  const withUpc = list.items.filter((item): item is ShoppingListItem & { upc: string } =>
    Boolean(item.upc),
  );
  const withoutUpc = list.items.filter((item) => !item.upc);

  if (withUpc.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text:
            `Shopping list "${list.name}" has no items with a UPC ready to add to the cart.\n` +
            (withoutUpc.length > 0
              ? `Use search_products to find UPCs for: ${withoutUpc.map((i) => i.productName).join(", ")}.`
              : ""),
        },
      ],
      ...appResult("add_shopping_list_to_cart", {
        listId,
        name: list.name,
        items: [],
        needsUpc: withoutUpc.map((i) => ({ productName: i.productName, quantity: i.quantity })),
        actionDetail: "No items with UPCs to add",
      }),
    };
  }

  const locationResult = await safeResolveLocationId(ctx.storage, storeId);
  if (locationResult.isErr()) return toMcpError(locationResult.error);
  const resolved = locationResult.value;

  const lineItems: LineItem[] = withUpc.map((item) => ({
    upc: item.upc,
    quantity: item.quantity,
    productName: item.productName,
  }));

  const addResult = await addLineItemsToCart(ctx, cartClient, lineItems, modality);
  if (addResult.isErr()) return toMcpError(addResult.error);

  // Persist the cart snapshot keyed by the namespaced storage key so a
  // retried call with the same listId short-circuits instead of
  // re-adding the same items to the cart.
  const snapshot = toCartSnapshotItems(lineItems, modality);

  const snapshotResult = await safeStorage(
    () => ctx.storage.cartSnapshot.set(listId, snapshot),
    "persist cart snapshot",
  );
  if (snapshotResult.isErr()) {
    return toMcpError(
      storageError(
        "Kroger accepted the cart add, but its local retry receipt could not be saved. The outcome is ambiguous; do not retry add_shopping_list_to_cart because that may add duplicates. Check the Kroger cart first.",
        snapshotResult.error,
      ),
    );
  }

  const locationInfo = resolved.locationName
    ? ` at ${resolved.locationName}`
    : ` (Store: ${resolved.locationId})`;

  const resultParts: string[] = [
    `Added ${withUpc.length} item(s) from list "${list.name}" to cart${locationInfo}:\n${withUpc.map((i) => `  - ${i.productName} x${i.quantity}`).join("\n")}`,
  ];

  if (withoutUpc.length > 0) {
    resultParts.push(
      `${withoutUpc.length} item(s) need a UPC before checkout (use search_products to find them, then create a new shopping list with create_shopping_list):\n${withoutUpc.map((i) => `  - ${i.productName} x${i.quantity}`).join("\n")}`,
    );
  }

  return {
    content: [{ type: "text" as const, text: resultParts.join("\n\n") }],
    ...appResult("add_shopping_list_to_cart", {
      listId,
      name: list.name,
      items: snapshot,
      needsUpc: withoutUpc.map((i) => ({
        productName: i.productName,
        quantity: i.quantity,
      })),
      actionDetail: `Added ${withUpc.length} item(s) from list "${list.name}" to cart`,
    }),
  };
}

const viewCartInputSchema = z.object({
  cartId: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      "Kroger cart UUID for a live cart read. Remembered after the first successful call, so later calls can omit it.",
    ),
});

function formatLiveCart(cart: LiveCart, cartId: string): string {
  const items = cart.items ?? [];
  const lines = items.map(
    (item) =>
      `- ${item.description ?? item.upc} x${item.quantity ?? 1} | upc=${item.upc} | ${item.modality}`,
  );
  return [
    `Live Kroger cart (cartId=${cartId}): ${items.length} item(s)`,
    lines.join("\n"),
    "Add more items with shop_for_items or add_shopping_list_to_cart.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Mirror fallback for view_cart: shows what this assistant added to the cart.
 * `note` (when set) explains why the live cart is not being shown.
 */
async function mirrorFallbackResult(ctx: ToolContext, note?: string) {
  const mirrorResult = await safeStorage(
    () => ctx.storage.cartMirror.getAll(),
    "fetch cart mirror",
  );
  if (mirrorResult.isErr()) return toMcpError(mirrorResult.error);

  const parts: string[] = note ? [note] : [];
  if (mirrorResult.value.length === 0) {
    parts.push(
      "No items added to your cart through this assistant yet. Use shop_for_items to search for items and add them to your Kroger cart.",
    );
  } else {
    const lines = mirrorResult.value.map(
      (item) =>
        `- ${item.productName ?? item.upc} x${item.quantity} | upc=${item.upc} | ${item.modality}`,
    );
    parts.push(
      `Items added to your Kroger cart through this assistant (in-store/app changes are not shown):\n\n${lines.join("\n")}`,
    );
  }
  return textResult(parts.join("\n\n"));
}

export function registerCartTools(ctx: ToolContext) {
  const { cartClient } = ctx.clients;

  registerAppTool(
    ctx.server,
    "add_shopping_list_to_cart",
    {
      title: "Add Shopping List to Cart",
      description:
        'Adds items to the Kroger/QFC cart, either from a listId returned by create_shopping_list or from inline upc/quantity items. Uses the preferred store when no storeId is supplied. Example: {"listId":"list_a1b2c3d8"}',
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: addShoppingListToCartInputSchema,
    },
    async ({ listId, items, storeId, modality }) => {
      getProps();
      if (listId) {
        return handleListIdCart(ctx, cartClient, listId, storeId, modality);
      }

      if (items) {
        return handleInlineItemsCart(ctx, cartClient, items, storeId, modality);
      }

      return toMcpError(
        validationError(
          "Provide either listId (from create_shopping_list) or items (inline upc/quantity pairs).",
        ),
      );
    },
  );

  ctx.server.registerTool(
    "view_cart",
    {
      title: "View Cart",
      description:
        "Shows the live Kroger cart when a cartId (from the Kroger website/app) has been provided once — it is remembered afterwards. Without one, shows only items added through this assistant.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: viewCartInputSchema,
    },
    async ({ cartId }) => {
      getProps();
      const storedIdResult = await safeStorage(
        () => ctx.storage.cartId.get(),
        "read stored cart id",
      );
      const resolvedId = cartId ?? (storedIdResult.isOk() ? storedIdResult.value : null);

      if (!resolvedId) {
        return mirrorFallbackResult(
          ctx,
          "No live cart id known — pass cartId to view_cart once to enable live cart reads.",
        );
      }

      const liveResult = await fromApiResponse(
        cartClient.GET("/v1/carts/{id}", { params: { path: { id: resolvedId } } }),
        "read live cart",
      );

      if (liveResult.isErr()) {
        return mirrorFallbackResult(
          ctx,
          cartId
            ? `Live cart read failed for cartId=${cartId} — the id may be stale or wrong. Showing items added through this assistant instead.`
            : `Live cart read failed (${liveResult.error.message}). Showing items added through this assistant instead.`,
        );
      }

      await safeStorage(() => ctx.storage.cartId.set(resolvedId), "store cart id").orTee((error) =>
        console.warn("Cart id store failed (non-fatal):", error.message),
      );
      return textResult(formatLiveCart(liveResult.value.data ?? {}, resolvedId));
    },
  );
}

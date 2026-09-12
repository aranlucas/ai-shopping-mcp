import { registerAppTool } from "../utils/app-tool.js";
import { err, ok, type Result } from "neverthrow";
import * as z from "zod/v4";

import type { AppError } from "../errors.js";
import type { components } from "../services/kroger/cart.js";

import { appResult } from "../app-results.js";
import type { KrogerClients } from "../services/kroger/client.js";
import type { CartSnapshotItem } from "../utils/user-storage.js";

import { mutationOutcomeUnknown, validationError } from "../errors.js";
import {
  fromApiResponse,
  getProps,
  safeResolveLocationId,
  safeStorage,
  toMcpError,
} from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { modalityEnum, storeIdSchema, upcSchema } from "./schemas.js";
import { type ToolContext, textResult } from "./types.js";

type CartItem = components["schemas"]["cart.cartItemModel"];
type CartItemRequest = components["schemas"]["cart.cartItemRequestModel"];
type LiveCart = components["schemas"]["carts.cartModel"];

type CartAddStatus = "added" | "already_added";

export type LineItem = { upc: string; quantity: number; productName?: string };

const inlineCartItemSchema = z.object({
  upc: upcSchema.describe("UPC from search_products"),
  quantity: z.coerce.number().int().min(1).max(999).default(1),
});

export const addShoppingListToCartInputSchema = z
  .object({
    operationId: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .describe("Inline retry key. Reuse for retries; change only for an intentional new add."),
    listId: z.string().min(1).optional().describe("listId from create_shopping_list"),
    items: z
      .array(inlineCartItemSchema)
      .min(1)
      .max(10)
      .optional()
      .describe("Inline UPC/quantity pairs; omit listId."),
    storeId: storeIdSchema
      .optional()
      .describe("8-character storeId from search_stores. Uses your preferred store if omitted."),
    modality: modalityEnum.default("PICKUP"),
  })
  .refine((value) => Boolean(value.listId) !== Boolean(value.items), {
    message:
      "Provide exactly one of listId (from create_shopping_list) or items (inline upc/quantity pairs) — not both, not neither.",
  });

function toCartSnapshotItems(
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
 * PUTs the given line items to the Kroger cart. Shared by every cart-write
 * path (listId, inline items, and `shop_for_items`'s `addToCart`) so the
 * PUT → mirror-append logic lives in one place. On success, also appends to
 * the per-user cart mirror
 * (`ctx.carts.cartMirror`) that `view_cart` reads — best-effort, a mirror
 * write failure does not fail the tool call. List-backed writes also persist
 * their retry receipt here so every caller gets the same duplicate protection.
 */
export async function addLineItemsToCart(
  ctx: ToolContext,
  cartClient: KrogerClients["cartClient"],
  lineItems: LineItem[],
  modality: "PICKUP" | "DELIVERY",
  options: {
    receiptListId?: string;
    operationId?: string;
  } = {},
): Promise<Result<CartAddStatus, AppError>> {
  const cartItems: CartItem[] = lineItems.map((item) => ({
    upc: item.upc,
    quantity: item.quantity,
    modality,
  }));
  const requestBody: CartItemRequest = { items: cartItems };

  const operationKey = options.receiptListId
    ? `list:${options.receiptListId}`
    : `inline:${options.operationId ?? crypto.randomUUID()}`;
  const claim = await safeStorage(
    () => ctx.carts.operations.begin(operationKey, JSON.stringify(cartItems)),
    "claim cart operation",
  );
  if (claim.isErr()) return err<CartAddStatus, AppError>(claim.error);
  if (claim.value.status === "conflict")
    return err<CartAddStatus, AppError>(
      validationError(
        "This cart operation was already used with different items. Check the Kroger cart before starting a new operation.",
      ),
    );
  if (claim.value.status === "completed") return ok("already_added");
  if (claim.value.status === "pending")
    return err<CartAddStatus, AppError>(
      mutationOutcomeUnknown(
        "This cart add is pending or its outcome is unknown; do not retry or create a replacement list. Check the Kroger cart first.",
      ),
    );
  const { attempt } = claim.value;

  const addResult = await fromApiResponse(
    () =>
      cartClient.PUT("/v1/cart/add", {
        body: requestBody,
        headers: { "Content-Type": "application/json" },
      }),
    "add items to cart",
  );

  if (addResult.isErr()) {
    const error = addResult.error;
    const rejected =
      error.type === "AUTH_ERROR" ||
      (error.type === "API_ERROR" &&
        error.status !== undefined &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408);
    if (rejected) {
      await safeStorage(
        () => ctx.carts.operations.reject(operationKey, attempt),
        "release rejected cart operation",
      ).orTee((failure) => console.warn("Cart claim release failed:", failure.message));
      return err<CartAddStatus, AppError>(error);
    }
    return err<CartAddStatus, AppError>(
      mutationOutcomeUnknown(
        "Kroger may have accepted the cart add, but confirmation was lost. The outcome is ambiguous; do not retry or create a replacement list. Check the Kroger cart first.",
        error,
      ),
    );
  }

  const committed = await safeStorage(
    () => ctx.carts.operations.complete(operationKey, attempt),
    "complete cart operation",
  );
  if (committed.isErr() || !committed.value)
    return err<CartAddStatus, AppError>(
      mutationOutcomeUnknown(
        "Kroger accepted the cart add, but its retry receipt could not be confirmed; do not retry. Check the Kroger cart first.",
        committed.isErr() ? committed.error : undefined,
      ),
    );

  const mirrorItems = toCartSnapshotItems(lineItems, modality);
  await safeStorage(
    () => ctx.carts.cartMirror.append(mirrorItems, new Date().toISOString()),
    "append cart mirror",
  ).orTee((e) => console.warn("Cart mirror append failed (non-fatal):", e.message));

  const receiptListId = options.receiptListId;
  if (receiptListId) {
    // The atomic journal is authoritative; keep legacy receipts for compatibility.
    await safeStorage(
      () => ctx.carts.cartSnapshot.set(receiptListId, mirrorItems),
      "persist cart snapshot",
    ).orTee((e) => console.warn("Legacy cart snapshot write failed (non-fatal):", e.message));
  }
  return ok("added");
}

async function handleInlineItemsCart(
  ctx: ToolContext,
  cartClient: KrogerClients["cartClient"],
  items: Array<{ upc: string; quantity: number }>,
  storeId: string | undefined,
  modality: "PICKUP" | "DELIVERY",
  operationId?: string,
) {
  const locationResult = await safeResolveLocationId(ctx.storage, storeId);
  if (locationResult.isErr()) return toMcpError(locationResult.error);

  const addResult = await addLineItemsToCart(ctx, cartClient, items, modality, { operationId });
  if (addResult.isErr()) return toMcpError(addResult.error);

  if (addResult.value === "already_added")
    return textResult(
      "These items were already added to your Kroger cart for this operation. Check the cart before adding more.",
    );
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
    () => ctx.carts.cartSnapshot.get(listId),
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

  const cartable = list.items.flatMap((item) => {
    const upc =
      item.product?.provider === "kroger"
        ? item.product.id
        : item.product === undefined
          ? item.upc
          : undefined;
    return upc ? [{ item, upc }] : [];
  });
  const cartableItems = new Set(cartable.map(({ item }) => item));
  const withoutUpc = list.items.filter((item) => !cartableItems.has(item));

  if (cartable.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text:
            `Shopping list "${list.name}" has no Kroger product references ready to add to the cart.\n` +
            (withoutUpc.length > 0
              ? `Use search_products with providers=["kroger"] for: ${withoutUpc.map((i) => i.productName).join(", ")}.`
              : ""),
        },
      ],
      ...appResult("add_shopping_list_to_cart", {
        listId,
        name: list.name,
        items: [],
        needsUpc: withoutUpc.map((i) => ({ productName: i.productName, quantity: i.quantity })),
        actionDetail: "No Kroger items to add",
      }),
    };
  }

  const locationResult = await safeResolveLocationId(ctx.storage, storeId);
  if (locationResult.isErr()) return toMcpError(locationResult.error);
  const resolved = locationResult.value;

  const lineItems: LineItem[] = cartable.map(({ item, upc }) => ({
    upc,
    quantity: item.quantity,
    productName: item.productName,
  }));

  const addResult = await addLineItemsToCart(ctx, cartClient, lineItems, modality, {
    receiptListId: listId,
  });
  if (addResult.isErr()) return toMcpError(addResult.error);
  if (addResult.value === "already_added")
    return textResult(`These items were already added to your Kroger cart from listId=${listId}.`);

  const snapshot = toCartSnapshotItems(lineItems, modality);

  const locationInfo = resolved.locationName
    ? ` at ${resolved.locationName}`
    : ` (Store: ${resolved.locationId})`;

  const resultParts: string[] = [
    `Added ${cartable.length} item(s) from list "${list.name}" to cart${locationInfo}:\n${cartable.map(({ item }) => `  - ${item.productName} x${item.quantity}`).join("\n")}`,
  ];

  if (withoutUpc.length > 0) {
    resultParts.push(
      `${withoutUpc.length} item(s) are not available through the Kroger cart (search Kroger for equivalents, then create a new list):\n${withoutUpc.map((i) => `  - ${i.productName} x${i.quantity}`).join("\n")}`,
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
      actionDetail: `Added ${cartable.length} item(s) from list "${list.name}" to cart`,
    }),
  };
}

const viewCartInputSchema = z.object({
  cartId: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Kroger cart UUID; remembered after a successful live read."),
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
  const mirrorResult = await safeStorage(() => ctx.carts.cartMirror.getAll(), "fetch cart mirror");
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
        'Add a saved list or inline UPCs to the Kroger cart. Omit storeId for your preferred store. Reuse operationId for inline retries. Example: {"listId":"list_a1b2c3d8"}',
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: addShoppingListToCartInputSchema,
    },
    async ({ listId, items, storeId, modality, operationId }) => {
      getProps();
      if (listId) {
        return handleListIdCart(ctx, cartClient, listId, storeId, modality);
      }

      if (items) {
        return handleInlineItemsCart(ctx, cartClient, items, storeId, modality, operationId);
      }

      return toMcpError(
        validationError(
          "Provide either listId (from create_shopping_list) or items (inline upc/quantity pairs).",
        ),
      );
    },
  );

  registerAppTool(
    ctx.server,
    "view_cart",
    {
      title: "View Cart",
      description:
        "Read the live Kroger cart using a remembered cartId, or show the assistant-only mirror when no id is known.",
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
      let resolvedId = cartId;
      if (!resolvedId) {
        const storedIdResult = await safeStorage(
          () => ctx.carts.cartId.get(),
          "read stored cart id",
        );
        if (storedIdResult.isErr()) return toMcpError(storedIdResult.error);
        resolvedId = storedIdResult.value ?? undefined;
      }

      if (!resolvedId) {
        return mirrorFallbackResult(
          ctx,
          "No live cart id known — pass cartId to view_cart once to enable live cart reads.",
        );
      }

      const liveCartId = resolvedId;
      const liveResult = await fromApiResponse(
        () => cartClient.GET("/v1/carts/{id}", { params: { path: { id: liveCartId } } }),
        "read live cart",
      );

      if (liveResult.isErr()) {
        if (liveResult.error.type === "AUTH_ERROR") return toMcpError(liveResult.error);
        return mirrorFallbackResult(
          ctx,
          `Live cart read failed${cartId ? ` for cartId=${cartId}` : ""} (${liveResult.error.message}). Showing items added through this assistant instead.`,
        );
      }

      await safeStorage(() => ctx.carts.cartId.set(resolvedId), "store cart id").orTee((error) =>
        console.warn("Cart id store failed (non-fatal):", error.message),
      );
      return textResult(formatLiveCart(liveResult.value.data ?? {}, resolvedId));
    },
  );
}

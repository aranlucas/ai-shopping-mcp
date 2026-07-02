import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { type Result, err, ok } from "neverthrow";
import * as z from "zod/v4";

import type { AppError } from "../errors.js";
import type { components } from "../services/kroger/cart.js";
import type { KrogerClients } from "../services/kroger/client.js";
import type { CartSnapshotItem, ShoppingListItem } from "../utils/user-storage.js";

import { validationError } from "../errors.js";
import {
  fromApiResponse,
  getProps,
  safeResolveLocationId,
  safeStorage,
  toMcpError,
} from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { modalityEnum, storeIdSchema, upcSchema } from "./schemas.js";
import { buildShoppingListStorageKey, requestCheckoutConfirmation } from "./shopping-list.js";
import { type Props, type ToolContext, textResult } from "./types.js";

type CartItem = components["schemas"]["cart.cartItemModel"];
type CartItemRequest = components["schemas"]["cart.cartItemRequestModel"];

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
  userId: string,
): Promise<Result<void, AppError>> {
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

  const mirrorItems: CartSnapshotItem[] = lineItems.map((item) => ({
    upc: item.upc,
    quantity: item.quantity,
    modality,
    productName: item.productName,
  }));

  await safeStorage(
    () => ctx.storage.cartMirror.append(userId, mirrorItems, new Date().toISOString()),
    "append cart mirror",
  ).orTee((e) => console.warn("Cart mirror append failed (non-fatal):", e.message));

  return ok<void, AppError>(undefined);
}

async function handleInlineItemsCart(
  ctx: ToolContext,
  cartClient: KrogerClients["cartClient"],
  props: Props,
  items: Array<{ upc: string; quantity: number }>,
  storeId: string | undefined,
  modality: "PICKUP" | "DELIVERY",
) {
  return safeResolveLocationId(ctx.storage, props.id, storeId).match(async (resolved) => {
    const addResult = await addLineItemsToCart(ctx, cartClient, items, modality, props.id);

    return addResult.match(() => {
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
        structuredContent: {
          _view: "add_shopping_list_to_cart" as const,
          listId: undefined,
          name: "Inline items",
          items: items.map((i) => ({ upc: i.upc, quantity: i.quantity, modality })),
          needsUpc: [],
          actionDetail: `Added ${items.length} item(s) to cart`,
        },
      };
    }, toMcpError);
  }, toMcpError);
}

async function handleListIdCart(
  ctx: ToolContext,
  cartClient: KrogerClients["cartClient"],
  props: Props,
  listId: string,
  storeId: string | undefined,
  modality: "PICKUP" | "DELIVERY",
) {
  const storageKey = buildShoppingListStorageKey(props.id, ctx.getSessionId(), listId);

  const existingSnapshotResult = await safeStorage(
    () => ctx.storage.cartSnapshot.get(storageKey),
    "check existing cart snapshot",
  );

  const existingSnapshot = existingSnapshotResult.match(
    (snapshot) => snapshot,
    () => null,
  );

  if (existingSnapshot && existingSnapshot.length > 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: "These items were already added to your cart from this list. Create a new list with create_shopping_list if you want to add more.",
        },
      ],
      structuredContent: {
        _view: "add_shopping_list_to_cart" as const,
        listId,
        name: "",
        items: existingSnapshot,
        needsUpc: [],
        actionDetail: "Already added to cart from this list",
      },
    };
  }

  return safeStorage(() => ctx.storage.shoppingList.get(storageKey), "fetch shopping list").match(
    async (list) => {
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
          structuredContent: {
            _view: "add_shopping_list_to_cart" as const,
            listId,
            name: list.name,
            items: [],
            needsUpc: withoutUpc.map((i) => ({ productName: i.productName, quantity: i.quantity })),
            actionDetail: "No items with UPCs to add",
          },
        };
      }

      return safeResolveLocationId(ctx.storage, props.id, storeId).match(async (resolved) => {
        const lineItems: LineItem[] = withUpc.map((item) => ({
          upc: item.upc,
          quantity: item.quantity,
          productName: item.productName,
        }));

        const addResult = await addLineItemsToCart(ctx, cartClient, lineItems, modality, props.id);

        return addResult.match(async () => {
          // Persist the cart snapshot keyed by the namespaced storage key so a
          // retried call with the same listId short-circuits instead of
          // re-adding the same items to the cart.
          const snapshot: CartSnapshotItem[] = lineItems.map((item) => ({
            upc: item.upc,
            quantity: item.quantity,
            modality,
            productName: item.productName,
          }));

          return safeStorage(
            () => ctx.storage.cartSnapshot.set(storageKey, snapshot),
            "persist cart snapshot",
          ).match(() => {
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
              structuredContent: {
                _view: "add_shopping_list_to_cart" as const,
                listId,
                name: list.name,
                items: snapshot,
                needsUpc: withoutUpc.map((i) => ({
                  productName: i.productName,
                  quantity: i.quantity,
                })),
                actionDetail: `Added ${withUpc.length} item(s) from list "${list.name}" to cart`,
              },
            };
          }, toMcpError);
        }, toMcpError);
      }, toMcpError);
    },
    toMcpError,
  );
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
      const props = getProps();

      if (listId) {
        return handleListIdCart(ctx, cartClient, props, listId, storeId, modality);
      }

      if (items) {
        return handleInlineItemsCart(ctx, cartClient, props, items, storeId, modality);
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
        "Shows items added to the Kroger cart through this assistant, with upc and quantity. The Kroger API has no cart-read endpoint, so in-store or Kroger-app changes never appear here — this is an assistant-only mirror, not the live cart.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: z.object({}),
    },
    async () => {
      const props = getProps();

      return safeStorage(() => ctx.storage.cartMirror.getAll(props.id), "fetch cart mirror").match(
        (items) => {
          if (items.length === 0) {
            return textResult(
              "No items added to your cart through this assistant yet. Use shop_for_items to search for items and add them to your Kroger cart.",
            );
          }

          const lines = items.map(
            (item) =>
              `- ${item.productName ?? item.upc} x${item.quantity} | upc=${item.upc} | ${item.modality}`,
          );

          return textResult(
            `Items added to your Kroger cart through this assistant (in-store/app changes are not shown):\n\n${lines.join("\n")}`,
          );
        },
        toMcpError,
      );
    },
  );
}

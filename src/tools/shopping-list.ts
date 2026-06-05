import { type Result, ResultAsync, err, errAsync, ok, safeTry } from "neverthrow";
import * as z from "zod/v4";

import type { AppError } from "../errors.js";
import type { components } from "../services/kroger/cart.js";
import type { ShoppingListItem } from "../utils/user-storage.js";

import { validationError } from "../errors.js";
import { formatShoppingListCompact } from "../utils/format-response.js";
import {
  fromApiResponse,
  requireAuth,
  safeResolveLocationId,
  safeStorage,
  toMcpError,
} from "../utils/result.js";
import { registerViewTool } from "../utils/view-resource.js";
import { manageShoppingListOutputSchema } from "./output-schemas.js";
import { type ToolContext, getSessionScopedUserId, textResult } from "./types.js";

type CartItem = components["schemas"]["cart.cartItemModel"];
type CartItemRequest = components["schemas"]["cart.cartItemRequestModel"];

type CheckoutConfirmationServer = {
  elicitInput(input: {
    message: string;
    requestedSchema: {
      type: "object";
      properties: {
        confirm: {
          type: "boolean";
          title: string;
          description: string;
          default: boolean;
        };
      };
    };
  }): Promise<{ action: "accept" | "decline" | "cancel"; content?: { confirm?: boolean } }>;
};

type CheckoutConfirmationItem = Pick<ShoppingListItem, "productName" | "quantity">;

export async function requestCheckoutConfirmation(
  server: CheckoutConfirmationServer,
  items: CheckoutConfirmationItem[],
): Promise<Result<void, AppError>> {
  const itemList = items.map((i) => `${i.productName} x${i.quantity}`).join(", ");

  const elicitResult = await ResultAsync.fromPromise(
    server.elicitInput({
      message: `Add ${items.length} item(s) to your Kroger cart? Items: ${itemList}`,
      requestedSchema: {
        type: "object" as const,
        properties: {
          confirm: {
            type: "boolean" as const,
            title: "Confirm checkout",
            description: "Add these items to your Kroger cart?",
            default: true,
          },
        },
      },
    }),
    () => validationError("elicitation_unsupported"),
  );

  // Client doesn't support elicitation — treat as implicit confirmation and proceed
  if (elicitResult.isErr()) return ok(undefined);

  const elicit = elicitResult.value;
  if (
    elicit.action === "decline" ||
    elicit.action === "cancel" ||
    (elicit.action === "accept" && elicit.content?.confirm === false)
  ) {
    return err(validationError("Checkout cancelled. Your shopping list remains unchanged."));
  }
  return ok(undefined);
}

export const manageShoppingListInputSchema = z.object({
  action: z
    .enum(["add", "remove", "update", "clear"])
    .describe("Action to perform on the shopping list"),
  items: z
    .array(
      z.object({
        productName: z
          .string()
          .min(1)
          .max(200)
          .describe("Product name (e.g., 'Whole Milk', 'Sourdough Bread')"),
        upc: z
          .string()
          .length(13, { message: "UPC must be exactly 13 characters" })
          .optional()
          .describe("13-digit UPC from product search, needed for cart checkout"),
        quantity: z.number().min(1).max(999).default(1),
        notes: z
          .string()
          .max(500)
          .optional()
          .describe("Optional notes (e.g., 'get organic if available')"),
      }),
    )
    .optional()
    .describe("Items to add (required for 'add' action)"),
  productName: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Name of product to remove or update (required for 'remove' and 'update' actions)"),
  quantity: z.number().min(1).max(999).optional().describe("New quantity (for 'update' action)"),
  upc: z
    .string()
    .length(13, { message: "UPC must be exactly 13 characters" })
    .optional()
    .describe("13-digit UPC to associate with item (for 'update' action)"),
  notes: z.string().max(500).optional().describe("Updated notes (for 'update' action)"),
});

export function registerShoppingListTools(ctx: ToolContext) {
  const { cartClient } = ctx.clients;

  registerViewTool(
    ctx,
    "manage_shopping_list",
    {
      title: "Manage Shopping List",
      description:
        "Manage your shopping list: add items, remove an item, update item details (quantity, UPC, notes), or clear all items. Build a list of products before checkout. Items with a UPC (from product search) can be sent directly to cart via checkout_shopping_list.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: manageShoppingListInputSchema,
      outputSchema: manageShoppingListOutputSchema,
    },
    async ({ action, items, productName, quantity, upc, notes }) => {
      const result = requireAuth(ctx.getUser).asyncAndThen((props) => {
        const { storage } = ctx;
        const scopedId = getSessionScopedUserId(props.id, ctx.getSessionId());

        switch (action) {
          case "add": {
            if (!items || items.length === 0) {
              return errAsync(
                validationError("Error: 'items' array is required for the 'add' action."),
              );
            }

            const now = new Date().toISOString();
            return safeStorage(async () => {
              for (const item of items) {
                const listItem: ShoppingListItem = {
                  productName: item.productName,
                  upc: item.upc,
                  quantity: item.quantity,
                  notes: item.notes,
                  addedAt: now,
                  checked: false,
                };
                await storage.shoppingList.add(scopedId, listItem);
              }
              return storage.shoppingList.getAll(scopedId);
            }, "add shopping list items").map((list) => ({
              text: `Added ${items.length} item(s) to shopping list.\n\nYour shopping list:\n\n${formatShoppingListCompact(list)}`,
              list,
              actionDetail: `Added ${items.length} item(s)`,
            }));
          }

          case "remove": {
            if (!productName) {
              return errAsync(
                validationError("Error: 'productName' is required for the 'remove' action."),
              );
            }

            return safeStorage(async () => {
              await storage.shoppingList.remove(scopedId, productName);
              return storage.shoppingList.getAll(scopedId);
            }, "remove shopping list item").map((list) => ({
              text: `Removed "${productName}" from shopping list.\n\nYour shopping list:\n\n${formatShoppingListCompact(list)}`,
              list,
              actionDetail: `Removed "${productName}"`,
            }));
          }

          case "update": {
            if (!productName) {
              return errAsync(
                validationError("Error: 'productName' is required for the 'update' action."),
              );
            }

            const updates: Partial<Pick<ShoppingListItem, "quantity" | "upc" | "notes">> = {};
            if (quantity !== undefined) updates.quantity = quantity;
            if (upc !== undefined) updates.upc = upc;
            if (notes !== undefined) updates.notes = notes;

            return safeStorage(async () => {
              await storage.shoppingList.updateItem(scopedId, productName, updates);
              return storage.shoppingList.getAll(scopedId);
            }, "update shopping list item").map((list) => ({
              text: `Updated "${productName}" on shopping list.\n\nYour shopping list:\n\n${formatShoppingListCompact(list)}`,
              list,
              actionDetail: `Updated "${productName}"`,
            }));
          }

          case "clear":
            return safeStorage(
              () => storage.shoppingList.clear(scopedId),
              "clear shopping list",
            ).map(() => ({
              text: "Shopping list cleared successfully.",
              list: [] as ShoppingListItem[],
              actionDetail: "List cleared",
            }));
        }
      });

      const res = await result;
      if (res.isErr()) {
        return toMcpError(res.error);
      }

      const { text, list, actionDetail } = res.value;

      return {
        content: [{ type: "text" as const, text }],
        structuredContent: {
          _view: "manage_shopping_list",
          items: list,
          actionDetail,
        },
      };
    },
  );

  registerViewTool(
    ctx,
    "checkout_shopping_list",
    {
      title: "Checkout Shopping List to Cart",
      description:
        "Adds all unchecked shopping list items with UPCs to your Kroger cart. Items without a UPC are listed separately so you can search for them first. After checkout, items are marked as checked.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: z.object({
        locationId: z
          .string()
          .length(8, { message: "Location ID must be exactly 8 characters" })
          .optional()
          .describe("Store location ID. If not provided, uses your preferred location."),
        modality: z.enum(["DELIVERY", "PICKUP"]).default("PICKUP"),
      }),
      outputSchema: manageShoppingListOutputSchema,
    },
    async ({ locationId, modality }) => {
      const { storage } = ctx;

      // Use safeTry for the entire checkout flow, including auth
      const result = await safeTry(async function* () {
        const props = yield* requireAuth(ctx.getUser).safeUnwrap();
        const scopedId = getSessionScopedUserId(props.id, ctx.getSessionId());

        const uncheckedItems = yield* safeStorage(
          () => storage.shoppingList.getUnchecked(scopedId),
          "fetch unchecked items",
        ).safeUnwrap();

        if (uncheckedItems.length === 0) {
          return ok(textResult("No unchecked items on your shopping list to checkout."));
        }

        const withUpc = uncheckedItems.filter((item) => item.upc);
        const withoutUpc = uncheckedItems.filter((item) => !item.upc);

        const resolved = yield* safeResolveLocationId(storage, props.id, locationId).safeUnwrap();

        const resultParts: string[] = [];

        if (withUpc.length > 0) {
          yield* (await requestCheckoutConfirmation(ctx.server.server, withUpc)).safeUnwrap();

          const cartItems: CartItem[] = withUpc.map((item) => ({
            upc: item.upc as string,
            quantity: item.quantity,
            modality,
          }));

          const requestBody: CartItemRequest = { items: cartItems };

          yield* fromApiResponse(
            cartClient.PUT("/v1/cart/add", {
              body: requestBody,
              headers: { "Content-Type": "application/json" },
            }),
            "add shopping list items to cart",
          ).safeUnwrap();

          // Mark checked items via safeStorage to avoid unhandled rejections
          yield* safeStorage(async () => {
            for (const item of withUpc) {
              await storage.shoppingList.updateItem(scopedId, item.productName, { checked: true });
            }
          }, "mark items as checked").safeUnwrap();

          const locationInfo = resolved.locationName
            ? ` at ${resolved.locationName}`
            : ` (Location: ${resolved.locationId})`;

          resultParts.push(
            `Added ${withUpc.length} item(s) to cart${locationInfo}:\n${withUpc.map((i) => `  - ${i.productName} x${i.quantity}`).join("\n")}`,
          );
        }

        if (withoutUpc.length > 0) {
          resultParts.push(
            `${withoutUpc.length} item(s) need a UPC before checkout (use search_products to find them, then manage_shopping_list with action 'update' to add the UPC):\n${withoutUpc.map((i) => `  - ${i.productName} x${i.quantity}`).join("\n")}`,
          );
        }

        const updatedList = yield* safeStorage(
          () => storage.shoppingList.getAll(scopedId),
          "fetch updated shopping list",
        ).safeUnwrap();

        resultParts.push(`\nYour shopping list:\n\n${formatShoppingListCompact(updatedList)}`);

        const text = resultParts.join("\n\n");

        return ok({
          content: [{ type: "text" as const, text }],
          structuredContent: {
            _view: "manage_shopping_list",
            items: updatedList,
            actionDetail: `Checkout complete: ${withUpc.length} item(s) added to cart`,
          },
        });
      });

      // safeTry returns Result — if Err, convert to MCP error; if Ok, return the MCP response directly
      if (result.isErr()) return toMcpError(result.error);
      return result.value;
    },
  );
}

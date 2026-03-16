import { errAsync, ok, ResultAsync, safeTry } from "neverthrow";
import { z } from "zod";
import { validationError } from "../errors.js";
import type { components } from "../services/kroger/cart.js";
import { formatShoppingListCompact } from "../utils/format-response.js";
import {
  fromApiResponse,
  requireAuth,
  safeResolveLocationId,
  safeStorage,
  toMcpError,
  toMcpResponse,
} from "../utils/result.js";
import type { ShoppingListItem } from "../utils/user-storage.js";
import {
  getSessionScopedUserId,
  type ToolContext,
  textResult,
} from "./types.js";

type CartItem = components["schemas"]["cart.cartItemModel"];
type CartItemRequest = components["schemas"]["cart.cartItemRequestModel"];

export function registerShoppingListTools(ctx: ToolContext) {
  const { cartClient } = ctx.clients;

  ctx.server.registerTool(
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
      inputSchema: z.object({
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
                .describe(
                  "Product name (e.g., 'Whole Milk', 'Sourdough Bread')",
                ),
              upc: z
                .string()
                .length(13, { message: "UPC must be exactly 13 characters" })
                .optional()
                .describe(
                  "13-digit UPC from product search, needed for cart checkout",
                ),
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
          .describe(
            "Name of product to remove or update (required for 'remove' and 'update' actions)",
          ),
        quantity: z
          .number()
          .min(1)
          .max(999)
          .optional()
          .describe("New quantity (for 'update' action)"),
        upc: z
          .string()
          .length(13, { message: "UPC must be exactly 13 characters" })
          .optional()
          .describe(
            "13-digit UPC to associate with item (for 'update' action)",
          ),
        notes: z
          .string()
          .max(500)
          .optional()
          .describe("Updated notes (for 'update' action)"),
      }),
    },
    async ({ action, items, productName, quantity, upc, notes }) => {
      const result = requireAuth(ctx.getUser()).asyncAndThen((props) => {
        const { storage } = ctx;
        const scopedId = getSessionScopedUserId(props.id, ctx.getSessionId());

        switch (action) {
          case "add": {
            if (!items || items.length === 0) {
              return errAsync(
                validationError(
                  "Error: 'items' array is required for the 'add' action.",
                ),
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
            }, "add shopping list items").map(
              (list) =>
                `Added ${items.length} item(s) to shopping list.\n\nYour shopping list:\n\n${formatShoppingListCompact(list)}`,
            );
          }

          case "remove": {
            if (!productName) {
              return errAsync(
                validationError(
                  "Error: 'productName' is required for the 'remove' action.",
                ),
              );
            }

            return safeStorage(async () => {
              await storage.shoppingList.remove(scopedId, productName);
              return storage.shoppingList.getAll(scopedId);
            }, "remove shopping list item").map(
              (list) =>
                `Removed "${productName}" from shopping list.\n\nYour shopping list:\n\n${formatShoppingListCompact(list)}`,
            );
          }

          case "update": {
            if (!productName) {
              return errAsync(
                validationError(
                  "Error: 'productName' is required for the 'update' action.",
                ),
              );
            }

            const updates: Partial<
              Pick<ShoppingListItem, "quantity" | "upc" | "notes">
            > = {};
            if (quantity !== undefined) updates.quantity = quantity;
            if (upc !== undefined) updates.upc = upc;
            if (notes !== undefined) updates.notes = notes;

            return safeStorage(async () => {
              await storage.shoppingList.updateItem(
                scopedId,
                productName,
                updates,
              );
              return storage.shoppingList.getAll(scopedId);
            }, "update shopping list item").map(
              (list) =>
                `Updated "${productName}" on shopping list.\n\nYour shopping list:\n\n${formatShoppingListCompact(list)}`,
            );
          }

          case "clear":
            return safeStorage(
              () => storage.shoppingList.clear(scopedId),
              "clear shopping list",
            ).map(() => "Shopping list cleared successfully.");
        }
      });

      return toMcpResponse(await result);
    },
  );

  ctx.server.registerTool(
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
          .describe(
            "Store location ID. If not provided, uses your preferred location.",
          ),
        modality: z.enum(["DELIVERY", "PICKUP"]).default("PICKUP"),
      }),
    },
    async ({ locationId, modality }) => {
      const { storage } = ctx;

      // Use safeTry for the entire checkout flow, including auth
      const result = await safeTry(async function* () {
        const props = yield* requireAuth(ctx.getUser()).safeUnwrap();
        const scopedId = getSessionScopedUserId(props.id, ctx.getSessionId());

        const uncheckedItems = yield* safeStorage(
          () => storage.shoppingList.getUnchecked(scopedId),
          "fetch unchecked items",
        ).safeUnwrap();

        if (uncheckedItems.length === 0) {
          return ok(
            textResult("No unchecked items on your shopping list to checkout."),
          );
        }

        const withUpc = uncheckedItems.filter((item) => item.upc);
        const withoutUpc = uncheckedItems.filter((item) => !item.upc);

        const resolved = yield* safeResolveLocationId(
          storage,
          props.id,
          locationId,
        ).safeUnwrap();

        const resultParts: string[] = [];

        if (withUpc.length > 0) {
          // Use MCP elicitation to confirm checkout with the user
          const elicitResult = await ResultAsync.fromPromise(
            ctx.server.server.elicitInput({
              message: `Add ${withUpc.length} item(s) to your Kroger cart? Items: ${withUpc.map((i) => `${i.productName} x${i.quantity}`).join(", ")}`,
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
            () => null, // Elicitation not supported by client
          ).orTee(() =>
            console.warn(
              "Elicitation unavailable, proceeding without confirmation",
            ),
          );

          if (elicitResult.isOk()) {
            const elicit = elicitResult.value;
            if (
              elicit.action === "decline" ||
              elicit.action === "cancel" ||
              (elicit.action === "accept" && elicit.content?.confirm === false)
            ) {
              return ok(
                textResult(
                  "Checkout cancelled. Your shopping list remains unchanged.",
                ),
              );
            }
          }

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
              await storage.shoppingList.updateItem(
                scopedId,
                item.productName,
                { checked: true },
              );
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

        resultParts.push(
          `\nYour shopping list:\n\n${formatShoppingListCompact(updatedList)}`,
        );

        return ok(textResult(resultParts.join("\n\n")));
      });

      // safeTry returns Result — if Err, convert to MCP error; if Ok, return the MCP response directly
      if (result.isErr()) return toMcpError(result.error);
      return result.value;
    },
  );
}

import { z } from "zod";
import type { components } from "../services/kroger/cart.js";
import { formatShoppingListCompact } from "../utils/format-response.js";
import {
  createUserStorage,
  type ShoppingListItem,
} from "../utils/user-storage.js";
import { requireAuth, resolveLocationId, type ToolContext } from "./types.js";

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
              quantity: z.number().min(1).default(1),
              notes: z
                .string()
                .optional()
                .describe("Optional notes (e.g., 'get organic if available')"),
            }),
          )
          .optional()
          .describe("Items to add (required for 'add' action)"),
        productName: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Name of product to remove or update (required for 'remove' and 'update' actions)",
          ),
        quantity: z
          .number()
          .min(1)
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
          .optional()
          .describe("Updated notes (for 'update' action)"),
      }),
    },
    async ({ action, items, productName, quantity, upc, notes }) => {
      const props = requireAuth(ctx);
      const storage = createUserStorage(ctx.getEnv().USER_DATA_KV);

      switch (action) {
        case "add": {
          if (!items || items.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: "Error: 'items' array is required for the 'add' action.",
                },
              ],
              isError: true,
            };
          }

          const now = new Date().toISOString();
          for (const item of items) {
            const listItem: ShoppingListItem = {
              productName: item.productName,
              upc: item.upc,
              quantity: item.quantity,
              notes: item.notes,
              addedAt: now,
              checked: false,
            };
            await storage.shoppingList.add(props.id, listItem);
          }

          const list = await storage.shoppingList.getAll(props.id);
          const formatted = formatShoppingListCompact(list);

          return {
            content: [
              {
                type: "text",
                text: `Added ${items.length} item(s) to shopping list.\n\nYour shopping list:\n\n${formatted}`,
              },
            ],
          };
        }

        case "remove": {
          if (!productName) {
            return {
              content: [
                {
                  type: "text",
                  text: "Error: 'productName' is required for the 'remove' action.",
                },
              ],
              isError: true,
            };
          }

          await storage.shoppingList.remove(props.id, productName);

          const list = await storage.shoppingList.getAll(props.id);
          const formatted = formatShoppingListCompact(list);

          return {
            content: [
              {
                type: "text",
                text: `Removed "${productName}" from shopping list.\n\nYour shopping list:\n\n${formatted}`,
              },
            ],
          };
        }

        case "update": {
          if (!productName) {
            return {
              content: [
                {
                  type: "text",
                  text: "Error: 'productName' is required for the 'update' action.",
                },
              ],
              isError: true,
            };
          }

          const updates: Partial<
            Pick<ShoppingListItem, "quantity" | "upc" | "notes">
          > = {};
          if (quantity !== undefined) updates.quantity = quantity;
          if (upc !== undefined) updates.upc = upc;
          if (notes !== undefined) updates.notes = notes;

          await storage.shoppingList.updateItem(props.id, productName, updates);

          const list = await storage.shoppingList.getAll(props.id);
          const formatted = formatShoppingListCompact(list);

          return {
            content: [
              {
                type: "text",
                text: `Updated "${productName}" on shopping list.\n\nYour shopping list:\n\n${formatted}`,
              },
            ],
          };
        }

        case "clear": {
          await storage.shoppingList.clear(props.id);

          return {
            content: [
              {
                type: "text",
                text: "Shopping list cleared successfully.",
              },
            ],
          };
        }
      }
    },
  );

  // --- Checkout tool (kept separate - distinct Kroger API interaction) ---

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
      const props = requireAuth(ctx);
      const storage = createUserStorage(ctx.getEnv().USER_DATA_KV);

      const uncheckedItems = await storage.shoppingList.getUnchecked(props.id);

      if (uncheckedItems.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No unchecked items on your shopping list to checkout.",
            },
          ],
        };
      }

      const withUpc = uncheckedItems.filter((item) => item.upc);
      const withoutUpc = uncheckedItems.filter((item) => !item.upc);

      let resolved: { locationId: string; locationName?: string };
      try {
        resolved = await resolveLocationId(storage, props.id, locationId);
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }

      const resultParts: string[] = [];

      if (withUpc.length > 0) {
        const cartItems: CartItem[] = withUpc.map((item) => ({
          upc: item.upc as string,
          quantity: item.quantity,
          modality,
        }));

        const requestBody: CartItemRequest = {
          items: cartItems,
        };

        const { error } = await cartClient.PUT("/v1/cart/add", {
          body: requestBody,
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (error) {
          console.error("Error adding shopping list items to cart:", error);
          return {
            content: [
              {
                type: "text",
                text: `Failed to add items to cart: ${JSON.stringify(error)}`,
              },
            ],
            isError: true,
          };
        }

        for (const item of withUpc) {
          await storage.shoppingList.updateItem(props.id, item.productName, {
            checked: true,
          });
        }

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

      const updatedList = await storage.shoppingList.getAll(props.id);
      const formatted = formatShoppingListCompact(updatedList);
      resultParts.push(`\nYour shopping list:\n\n${formatted}`);

      return {
        content: [
          {
            type: "text",
            text: resultParts.join("\n\n"),
          },
        ],
      };
    },
  );
}

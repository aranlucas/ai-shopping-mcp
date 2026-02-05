import { z } from "zod";
import type { components } from "../services/kroger/cart.js";
import { cartClient } from "../services/kroger/client.js";
import { formatShoppingListCompact } from "../utils/format-response.js";
import {
  createUserStorage,
  type ShoppingListItem,
} from "../utils/user-storage.js";
import { requireAuth, resolveLocationId, type ToolContext } from "./types.js";

type CartItem = components["schemas"]["cart.cartItemModel"];
type CartItemRequest = components["schemas"]["cart.cartItemRequestModel"];

export function registerShoppingListTools(ctx: ToolContext) {
  ctx.server.registerTool(
    "add_to_shopping_list",
    {
      description:
        "Adds items to your shopping list for planning before checkout. Use this to build a list of products you want to buy. Items can include a UPC (from product search) for direct cart checkout, or just a product name to find later. If the item already exists, its quantity is increased.",
      inputSchema: z.object({
        items: z.array(
          z.object({
            productName: z
              .string()
              .min(1)
              .describe("Product name (e.g., 'Whole Milk', 'Sourdough Bread')"),
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
        ),
      }),
    },
    async ({ items }) => {
      const props = requireAuth(ctx);
      const storage = createUserStorage(ctx.getEnv().USER_DATA_KV);
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
    },
  );

  ctx.server.registerTool(
    "remove_from_shopping_list",
    {
      description: "Removes an item from your shopping list by name.",
      inputSchema: z.object({
        productName: z.string().min(1).describe("Name of product to remove"),
      }),
    },
    async ({ productName }) => {
      const props = requireAuth(ctx);
      const storage = createUserStorage(ctx.getEnv().USER_DATA_KV);
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
    },
  );

  ctx.server.registerTool(
    "update_shopping_list_item",
    {
      description:
        "Updates an item on your shopping list. Use this to change quantity, add a UPC (after searching for the product), or add notes.",
      inputSchema: z.object({
        productName: z.string().min(1).describe("Name of product to update"),
        quantity: z.number().min(1).optional().describe("New quantity"),
        upc: z
          .string()
          .length(13, { message: "UPC must be exactly 13 characters" })
          .optional()
          .describe("13-digit UPC to associate with this item"),
        notes: z.string().optional().describe("Updated notes"),
      }),
    },
    async ({ productName, quantity, upc, notes }) => {
      const props = requireAuth(ctx);
      const storage = createUserStorage(ctx.getEnv().USER_DATA_KV);

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
    },
  );

  ctx.server.registerTool(
    "clear_shopping_list",
    {
      description:
        "Removes all items from your shopping list. Use this to start fresh.",
      inputSchema: z.object({}),
    },
    async () => {
      const props = requireAuth(ctx);
      const storage = createUserStorage(ctx.getEnv().USER_DATA_KV);
      await storage.shoppingList.clear(props.id);

      return {
        content: [
          {
            type: "text",
            text: "Shopping list cleared successfully.",
          },
        ],
      };
    },
  );

  ctx.server.registerTool(
    "checkout_shopping_list",
    {
      description:
        "Adds all unchecked items from your shopping list to your Kroger cart. Only items with a UPC can be added to the cart. Items without a UPC will be listed separately so you can search for them. After checkout, items are marked as checked.",
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

      const resolved = await resolveLocationId(storage, props.id, locationId);

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
          throw new Error(
            `Failed to add items to cart: ${JSON.stringify(error)}`,
          );
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
          `${withoutUpc.length} item(s) need a UPC before checkout (use search_products to find them, then update_shopping_list_item to add the UPC):\n${withoutUpc.map((i) => `  - ${i.productName} x${i.quantity}`).join("\n")}`,
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

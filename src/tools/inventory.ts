import { z } from "zod";
import {
  formatEquipmentListCompact,
  formatOrderHistoryCompact,
  formatPantryListCompact,
} from "../utils/format-response.js";
import {
  createUserStorage,
  type EquipmentItem,
  type OrderRecord,
  type PantryItem,
} from "../utils/user-storage.js";
import { requireAuth, type ToolContext } from "./types.js";

export function registerInventoryTools(ctx: ToolContext) {
  // --- Consolidated pantry tool ---

  ctx.server.registerTool(
    "manage_pantry",
    {
      title: "Manage Pantry Inventory",
      description:
        "Manage your pantry inventory: add items, remove an item, or clear all items. Tracks what groceries you have at home to avoid duplicate purchases and enable meal planning.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: z.object({
        action: z
          .enum(["add", "remove", "clear"])
          .describe("Action to perform on the pantry"),
        items: z
          .array(
            z.object({
              productName: z
                .string()
                .min(1)
                .max(200)
                .describe(
                  "Normalized product name (e.g., 'Eggs', 'Milk', 'Bread')",
                ),
              quantity: z.number().min(1).max(999),
              expiresAt: z.string().optional(),
            }),
          )
          .optional()
          .describe("Items to add (required for 'add' action)"),
        productName: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe("Name of product to remove (required for 'remove' action)"),
      }),
    },
    async ({ action, items, productName }) => {
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
            const pantryItem: PantryItem = {
              productName: item.productName,
              quantity: item.quantity,
              addedAt: now,
              expiresAt: item.expiresAt,
            };
            await storage.pantry.add(props.id, pantryItem);
          }

          const pantry = await storage.pantry.getAll(props.id);
          const formatted = formatPantryListCompact(pantry);

          return {
            content: [
              {
                type: "text",
                text: `Added ${items.length} item(s) to pantry.\n\nYour pantry:\n\n${formatted}`,
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

          await storage.pantry.remove(props.id, productName);

          const pantry = await storage.pantry.getAll(props.id);
          const formatted = formatPantryListCompact(pantry);

          return {
            content: [
              {
                type: "text",
                text: `Item removed from pantry.\n\nYour pantry:\n\n${formatted}`,
              },
            ],
          };
        }

        case "clear": {
          await storage.pantry.clear(props.id);

          return {
            content: [
              {
                type: "text",
                text: "Pantry cleared successfully.",
              },
            ],
          };
        }
      }
    },
  );

  // --- Consolidated equipment tool ---

  ctx.server.registerTool(
    "manage_equipment",
    {
      title: "Manage Kitchen Equipment",
      description:
        "Manage your kitchen equipment inventory: add items, remove an item, or clear all. Tracks what cooking tools you own for recipe matching and meal planning.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: z.object({
        action: z
          .enum(["add", "remove", "clear"])
          .describe("Action to perform on equipment inventory"),
        items: z
          .array(
            z.object({
              equipmentName: z.string().min(1).max(200),
              category: z
                .string()
                .max(100)
                .optional()
                .describe(
                  "Optional category (e.g., 'Baking', 'Cooking', 'Utensils', 'Appliances')",
                ),
            }),
          )
          .optional()
          .describe("Equipment items to add (required for 'add' action)"),
        equipmentName: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe(
            "Name of equipment to remove (required for 'remove' action)",
          ),
      }),
    },
    async ({ action, items, equipmentName }) => {
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
            const equipmentItem: EquipmentItem = {
              equipmentName: item.equipmentName,
              category: item.category,
              addedAt: now,
            };
            await storage.equipment.add(props.id, equipmentItem);
          }

          const equipment = await storage.equipment.getAll(props.id);
          const formatted = formatEquipmentListCompact(equipment);

          return {
            content: [
              {
                type: "text",
                text: `Added ${items.length} item(s) to equipment.\n\nYour equipment:\n\n${formatted}`,
              },
            ],
          };
        }

        case "remove": {
          if (!equipmentName) {
            return {
              content: [
                {
                  type: "text",
                  text: "Error: 'equipmentName' is required for the 'remove' action.",
                },
              ],
              isError: true,
            };
          }

          await storage.equipment.remove(props.id, equipmentName);

          const equipment = await storage.equipment.getAll(props.id);
          const formatted = formatEquipmentListCompact(equipment);

          return {
            content: [
              {
                type: "text",
                text: `Item removed from equipment.\n\nYour equipment:\n\n${formatted}`,
              },
            ],
          };
        }

        case "clear": {
          await storage.equipment.clear(props.id);

          return {
            content: [
              {
                type: "text",
                text: "Equipment cleared successfully.",
              },
            ],
          };
        }
      }
    },
  );

  // --- Order history ---

  ctx.server.registerTool(
    "mark_order_placed",
    {
      title: "Record Order",
      description:
        "Records a completed order in your order history for tracking purchases over time.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: z.object({
        items: z.array(
          z.object({
            productId: z.string(),
            productName: z.string().max(200),
            quantity: z.number().min(1).max(999),
            price: z.number().min(0).optional(),
          }),
        ),
        locationId: z.string().optional(),
        notes: z.string().max(500).optional(),
      }),
    },
    async ({ items, locationId, notes }) => {
      const props = requireAuth(ctx);
      const storage = createUserStorage(ctx.getEnv().USER_DATA_KV);

      const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
      const estimatedTotal = items.reduce((sum, item) => {
        return sum + (item.price || 0) * item.quantity;
      }, 0);

      const order: OrderRecord = {
        orderId,
        items,
        totalItems,
        estimatedTotal: estimatedTotal > 0 ? estimatedTotal : undefined,
        placedAt: new Date().toISOString(),
        locationId,
        notes,
      };

      await storage.orderHistory.add(props.id, order);

      const formatted = formatOrderHistoryCompact([order]);

      return {
        content: [
          {
            type: "text",
            text: `Order recorded successfully:\n\n${formatted}`,
          },
        ],
      };
    },
  );
}

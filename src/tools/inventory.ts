import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { errAsync } from "neverthrow";
import { z } from "zod";
import { validationError } from "../errors.js";
import {
  formatEquipmentListCompact,
  formatOrderHistoryCompact,
  formatPantryListCompact,
} from "../utils/format-response.js";
import { requireAuth, safeStorage, toMcpResponse } from "../utils/result.js";
import type {
  EquipmentItem,
  OrderRecord,
  PantryItem,
} from "../utils/user-storage.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import type { ToolContext } from "./types.js";

export function registerInventoryTools(ctx: ToolContext) {
  registerAppTool(
    ctx.server,
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
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
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
      const result = requireAuth(ctx.getUser).asyncAndThen((props) => {
        const { storage } = ctx;

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
                const pantryItem: PantryItem = {
                  productName: item.productName,
                  quantity: item.quantity,
                  addedAt: now,
                  expiresAt: item.expiresAt,
                };
                await storage.pantry.add(props.id, pantryItem);
              }
              return storage.pantry.getAll(props.id);
            }, "add pantry items").map((pantry) => ({
              text: `Added ${items.length} item(s) to pantry.\n\nYour pantry:\n\n${formatPantryListCompact(pantry)}`,
              pantry,
              actionDetail: `Added ${items.length} item(s)`,
            }));
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
              await storage.pantry.remove(props.id, productName);
              return storage.pantry.getAll(props.id);
            }, "remove pantry item").map((pantry) => ({
              text: `Item removed from pantry.\n\nYour pantry:\n\n${formatPantryListCompact(pantry)}`,
              pantry,
              actionDetail: `Removed "${productName}"`,
            }));
          }

          case "clear":
            return safeStorage(
              () => storage.pantry.clear(props.id),
              "clear pantry",
            ).map(() => ({
              text: "Pantry cleared successfully.",
              pantry: [] as PantryItem[],
              actionDetail: "Pantry cleared",
            }));
        }
      });

      const res = await result;
      if (res.isErr()) {
        return toMcpResponse(res.map(() => ""));
      }

      const { text, pantry, actionDetail } = res.value;

      return {
        content: [{ type: "text" as const, text }],
        structuredContent: {
          _view: "manage_pantry",
          items: pantry,
          actionDetail,
        },
      };
    },
  );

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
      const result = requireAuth(ctx.getUser).asyncAndThen((props) => {
        const { storage } = ctx;

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
                const equipmentItem: EquipmentItem = {
                  equipmentName: item.equipmentName,
                  category: item.category,
                  addedAt: now,
                };
                await storage.equipment.add(props.id, equipmentItem);
              }
              return storage.equipment.getAll(props.id);
            }, "add equipment items").map(
              (equipment) =>
                `Added ${items.length} item(s) to equipment.\n\nYour equipment:\n\n${formatEquipmentListCompact(equipment)}`,
            );
          }

          case "remove": {
            if (!equipmentName) {
              return errAsync(
                validationError(
                  "Error: 'equipmentName' is required for the 'remove' action.",
                ),
              );
            }

            return safeStorage(async () => {
              await storage.equipment.remove(props.id, equipmentName);
              return storage.equipment.getAll(props.id);
            }, "remove equipment item").map(
              (equipment) =>
                `Item removed from equipment.\n\nYour equipment:\n\n${formatEquipmentListCompact(equipment)}`,
            );
          }

          case "clear":
            return safeStorage(
              () => storage.equipment.clear(props.id),
              "clear equipment",
            ).map(() => "Equipment cleared successfully.");
        }
      });

      return toMcpResponse(await result);
    },
  );

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
      const result = requireAuth(ctx.getUser).asyncAndThen((props) => {
        const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
        const estimatedTotal = items.reduce(
          (sum, item) => sum + (item.price || 0) * item.quantity,
          0,
        );

        const order: OrderRecord = {
          orderId,
          items,
          totalItems,
          estimatedTotal: estimatedTotal > 0 ? estimatedTotal : undefined,
          placedAt: new Date().toISOString(),
          locationId,
          notes,
        };

        return safeStorage(
          () => ctx.storage.orderHistory.add(props.id, order),
          "record order",
        ).map(
          () =>
            `Order recorded successfully:\n\n${formatOrderHistoryCompact([order])}`,
        );
      });

      return toMcpResponse(await result);
    },
  );
}

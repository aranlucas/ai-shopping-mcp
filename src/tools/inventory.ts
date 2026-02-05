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
  // --- Pantry tools ---

  ctx.server.registerTool(
    "add_to_pantry",
    {
      description:
        "Adds items to your personal pantry inventory. Use this to track what groceries you already have at home. Helps avoid buying duplicates and manage inventory. Use normalized, consistent product names (e.g., 'Milk' not 'milk 2%' or 'whole milk') to prevent duplicates.",
      inputSchema: z.object({
        items: z.array(
          z.object({
            productName: z
              .string()
              .min(1)
              .describe(
                "Normalized product name (e.g., 'Eggs', 'Milk', 'Bread')",
              ),
            quantity: z.number().min(1),
            expiresAt: z.string().optional(),
          }),
        ),
      }),
    },
    async ({ items }) => {
      const props = requireAuth(ctx);
      const storage = createUserStorage(ctx.getEnv().USER_DATA_KV);
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
    },
  );

  ctx.server.registerTool(
    "remove_from_pantry",
    {
      description:
        "Removes an item from your pantry inventory. Use this when you've used up an item or want to remove it from tracking.",
      inputSchema: z.object({
        productName: z.string().min(1).describe("Name of product to remove"),
      }),
    },
    async ({ productName }) => {
      const props = requireAuth(ctx);
      const storage = createUserStorage(ctx.getEnv().USER_DATA_KV);
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
    },
  );

  ctx.server.registerTool(
    "clear_pantry",
    {
      description:
        "Removes all items from your pantry inventory. Use this to start fresh with pantry tracking.",
      inputSchema: z.object({}),
    },
    async () => {
      const props = requireAuth(ctx);
      const storage = createUserStorage(ctx.getEnv().USER_DATA_KV);
      await storage.pantry.clear(props.id);

      return {
        content: [
          {
            type: "text",
            text: "Pantry cleared successfully.",
          },
        ],
      };
    },
  );

  // --- Equipment tools ---

  ctx.server.registerTool(
    "add_to_equipment",
    {
      description:
        "Adds kitchen equipment or tools to your personal equipment inventory. Use this to track what cooking equipment you own. Helps with recipe planning and knowing what tools you have available.",
      inputSchema: z.object({
        items: z.array(
          z.object({
            equipmentName: z.string().min(1),
            category: z
              .string()
              .optional()
              .describe(
                "Optional category (e.g., 'Baking', 'Cooking', 'Utensils', 'Appliances')",
              ),
          }),
        ),
      }),
    },
    async ({ items }) => {
      const props = requireAuth(ctx);
      const storage = createUserStorage(ctx.getEnv().USER_DATA_KV);
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
    },
  );

  ctx.server.registerTool(
    "remove_from_equipment",
    {
      description:
        "Removes an item from your equipment inventory. Use this when you no longer have a piece of equipment or want to remove it from tracking.",
      inputSchema: z.object({
        equipmentName: z
          .string()
          .min(1)
          .describe("Name of equipment to remove"),
      }),
    },
    async ({ equipmentName }) => {
      const props = requireAuth(ctx);
      const storage = createUserStorage(ctx.getEnv().USER_DATA_KV);
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
    },
  );

  ctx.server.registerTool(
    "clear_equipment",
    {
      description:
        "Removes all items from your equipment inventory. Use this to start fresh with equipment tracking.",
      inputSchema: z.object({}),
    },
    async () => {
      const props = requireAuth(ctx);
      const storage = createUserStorage(ctx.getEnv().USER_DATA_KV);
      await storage.equipment.clear(props.id);

      return {
        content: [
          {
            type: "text",
            text: "Equipment cleared successfully.",
          },
        ],
      };
    },
  );

  // --- Order history ---

  ctx.server.registerTool(
    "mark_order_placed",
    {
      description:
        "Records a completed order in your order history. Use this after successfully placing an order to track your purchases over time.",
      inputSchema: z.object({
        items: z.array(
          z.object({
            productId: z.string(),
            productName: z.string(),
            quantity: z.number().min(1),
            price: z.number().optional(),
          }),
        ),
        locationId: z.string().optional(),
        notes: z.string().optional(),
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

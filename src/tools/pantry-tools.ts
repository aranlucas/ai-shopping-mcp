import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Props } from "../server.js";
import { formatPantryListCompact } from "../utils/format-response.js";
import { createUserStorage, type PantryItem } from "../utils/user-storage.js";

/**
 * Registers pantry inventory management tools with the MCP server.
 *
 * Tools:
 * - add_to_pantry: Add items to pantry inventory
 * - remove_from_pantry: Remove items from pantry
 * - view_pantry: Display all pantry items
 * - clear_pantry: Clear entire pantry
 */
export function registerPantryTools(
  server: McpServer,
  env: Env,
  getProps: () => Props | undefined,
) {
  // Add to pantry tool
  server.registerTool(
    "add_to_pantry",
    {
      description:
        "Adds items to your personal pantry inventory. Use this to track what groceries you already have at home. Helps avoid buying duplicates and manage inventory.",
      inputSchema: z.object({
        items: z.array(
          z.object({
            productId: z
              .string()
              .length(13, { message: "Product ID must be 13 digits" }),
            productName: z.string(),
            quantity: z.number().min(1),
            expiresAt: z.string().optional(),
          }),
        ),
      }),
    },
    async ({ items }) => {
      const props = getProps();
      if (!props?.id) {
        throw new Error("User not authenticated");
      }

      const storage = createUserStorage(env.USER_DATA_KV);
      const now = new Date().toISOString();

      for (const item of items) {
        const pantryItem: PantryItem = {
          productId: item.productId,
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

  // Remove from pantry tool
  server.registerTool(
    "remove_from_pantry",
    {
      description:
        "Removes an item from your pantry inventory. Use this when you've used up an item or want to remove it from tracking.",
      inputSchema: z.object({
        productId: z
          .string()
          .length(13, { message: "Product ID must be 13 digits" }),
      }),
    },
    async ({ productId }) => {
      const props = getProps();
      if (!props?.id) {
        throw new Error("User not authenticated");
      }

      const storage = createUserStorage(env.USER_DATA_KV);
      await storage.pantry.remove(props.id, productId);

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

  // View pantry tool
  server.registerTool(
    "view_pantry",
    {
      description:
        "Displays all items currently in your pantry inventory. Use this to see what groceries you have at home before shopping.",
      inputSchema: z.object({}),
    },
    async () => {
      const props = getProps();
      if (!props?.id) {
        throw new Error("User not authenticated");
      }

      const storage = createUserStorage(env.USER_DATA_KV);
      const pantry = await storage.pantry.getAll(props.id);
      const formatted = formatPantryListCompact(pantry);

      return {
        content: [
          {
            type: "text",
            text: `Your pantry (${pantry.length} items):\n\n${formatted}`,
          },
        ],
      };
    },
  );

  // Clear pantry tool
  server.registerTool(
    "clear_pantry",
    {
      description:
        "Removes all items from your pantry inventory. Use this to start fresh with pantry tracking.",
      inputSchema: z.object({}),
    },
    async () => {
      const props = getProps();
      if (!props?.id) {
        throw new Error("User not authenticated");
      }

      const storage = createUserStorage(env.USER_DATA_KV);
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
}

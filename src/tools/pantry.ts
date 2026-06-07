import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import * as z from "zod/v4";

import type { PantryItem } from "../utils/user-storage.js";
import type { ToolContext } from "./types.js";

import { validationError } from "../errors.js";
import { formatPantryListCompact } from "../utils/format-response.js";
import { getProps, safeStorage, toMcpError } from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { managePantryOutputSchema } from "./output-schemas.js";

/** Input schema for the `manage_pantry` tool. Exported so the client can infer
 *  its argument type (see `tool-types.ts`) for type-safe `callTool()` calls. */
export const managePantryInputSchema = z.object({
  action: z.enum(["add", "remove", "clear"]).describe("Action to perform on the pantry"),
  items: z
    .array(
      z.object({
        productName: z
          .string()
          .min(1)
          .max(200)
          .describe("Normalized product name (e.g., 'Eggs', 'Milk', 'Bread')"),
        quantity: z.number().min(1).max(999).optional(),
        expiresAt: z.string().optional(),
      }),
    )
    .optional()
    .describe("Items to add or remove (required for 'add' and 'remove' actions)"),
});

export function registerPantryTools(ctx: ToolContext) {
  registerAppTool(
    ctx.server,
    "manage_pantry",
    {
      title: "Manage Pantry Inventory",
      description:
        "Manage your pantry inventory: add items, remove an item, or clear all items. Tracks what groceries you have at home to avoid duplicate purchases and enable meal planning.",
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: managePantryInputSchema,
      outputSchema: managePantryOutputSchema,
    },
    async ({ action, items }) => {
      const props = getProps();
      const { storage } = ctx;

      switch (action) {
        case "add": {
          if (!items || items.length === 0) {
            return toMcpError(
              validationError("Error: 'items' array is required for the 'add' action."),
            );
          }

          const now = new Date().toISOString();
          const result = await safeStorage(async () => {
            for (const item of items) {
              const pantryItem: PantryItem = {
                productName: item.productName,
                quantity: item.quantity ?? 1,
                addedAt: now,
                expiresAt: item.expiresAt,
              };
              await storage.pantry.add(props.id, pantryItem);
            }
            return storage.pantry.getAll(props.id);
          }, "add pantry items").map((pantry) => ({
            content: [
              {
                type: "text" as const,
                text: `Added ${items.length} item(s) to pantry.\n\nYour pantry:\n\n${formatPantryListCompact(pantry)}`,
              },
            ],
            structuredContent: {
              _view: "manage_pantry" as const,
              items: pantry,
              actionDetail: `Added ${items.length} item(s)`,
            },
          }));
          if (result.isErr()) return toMcpError(result.error);
          return result.value;
        }

        case "remove": {
          if (!items || items.length === 0) {
            return toMcpError(
              validationError("Error: 'items' array is required for the 'remove' action."),
            );
          }

          const result = await safeStorage(async () => {
            for (const item of items) {
              await storage.pantry.remove(props.id, item.productName);
            }
            return storage.pantry.getAll(props.id);
          }, "remove pantry items").map((pantry) => ({
            content: [
              {
                type: "text" as const,
                text: `Removed ${items.length} item(s) from pantry.\n\nYour pantry:\n\n${formatPantryListCompact(pantry)}`,
              },
            ],
            structuredContent: {
              _view: "manage_pantry" as const,
              items: pantry,
              actionDetail: `Removed ${items.length} item(s)`,
            },
          }));
          if (result.isErr()) return toMcpError(result.error);
          return result.value;
        }

        case "clear": {
          const result = await safeStorage(
            () => storage.pantry.clear(props.id),
            "clear pantry",
          ).map(() => ({
            content: [{ type: "text" as const, text: "Pantry cleared successfully." }],
            structuredContent: {
              _view: "manage_pantry" as const,
              items: [] as PantryItem[],
              actionDetail: "Pantry cleared",
            },
          }));
          if (result.isErr()) return toMcpError(result.error);
          return result.value;
        }
      }
    },
  );
}

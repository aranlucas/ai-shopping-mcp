import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import * as z from "zod/v4";

import type { PantryItem } from "../utils/user-storage.js";
import type { ToolContext } from "./types.js";

import { validationError } from "../errors.js";
import { formatPantryListCompact } from "../utils/format-response.js";
import { getProps, safeStorage, toMcpError } from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";

const pantryMutationItemSchema = z.object({
  productName: z
    .string()
    .min(1)
    .max(200)
    .describe("Normalized product name (e.g., 'Eggs', 'Milk', 'Bread')"),
  quantity: z.number().min(1).max(999).optional(),
  expiresAt: z.string().optional(),
});

const pantryRemovalItemSchema = z.object({
  productName: z.string().min(1).max(200).describe("Name of the pantry item to remove"),
});

export const addPantryItemsInputSchema = z.object({
  items: z
    .array(pantryMutationItemSchema)
    .min(1, { message: "At least one pantry item is required" })
    .describe("Pantry items to add or quantity-increment by case-insensitive product name"),
});

export const removePantryItemsInputSchema = z.object({
  items: z
    .array(pantryRemovalItemSchema)
    .min(1, { message: "At least one pantry item is required" })
    .describe("Pantry items to remove by case-insensitive product name"),
});

export const clearPantryInputSchema = z.object({});

function pantryResponse(text: string, items: PantryItem[], actionDetail: string) {
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: {
      _view: "pantry" as const,
      items,
      actionDetail,
    },
  };
}

export function registerPantryTools(ctx: ToolContext) {
  registerAppTool(
    ctx.server,
    "add_pantry_items",
    {
      title: "Add Pantry Items",
      description:
        "Adds grocery items the user already has at home to pantry storage. Duplicate product names are merged case-insensitively and quantities are incremented for meal planning and duplicate-purchase avoidance.",
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: addPantryItemsInputSchema,
    },
    async ({ items }) => {
      if (!items || items.length === 0) {
        return toMcpError(validationError("Error: 'items' array is required."));
      }

      const props = getProps();
      const now = new Date().toISOString();
      const result = await safeStorage(async () => {
        for (const item of items) {
          const pantryItem: PantryItem = {
            productName: item.productName,
            quantity: item.quantity ?? 1,
            addedAt: now,
            expiresAt: item.expiresAt,
          };
          await ctx.storage.pantry.add(props.id, pantryItem);
        }
        return ctx.storage.pantry.getAll(props.id);
      }, "add pantry items").map((pantry) =>
        pantryResponse(
          `Added ${items.length} item(s) to pantry.\n\nYour pantry:\n\n${formatPantryListCompact(pantry)}`,
          pantry,
          `Added ${items.length} item(s)`,
        ),
      );

      return result.match((response) => response, toMcpError);
    },
  );

  registerAppTool(
    ctx.server,
    "remove_pantry_items",
    {
      title: "Remove Pantry Items",
      description:
        "Removes one or more pantry entries by product name when the user has used, discarded, or no longer owns those items. Returns the updated pantry inventory for meal planning context.",
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: removePantryItemsInputSchema,
    },
    async ({ items }) => {
      if (!items || items.length === 0) {
        return toMcpError(validationError("Error: 'items' array is required."));
      }

      const props = getProps();
      const result = await safeStorage(async () => {
        for (const item of items) {
          await ctx.storage.pantry.remove(props.id, item.productName);
        }
        return ctx.storage.pantry.getAll(props.id);
      }, "remove pantry items").map((pantry) =>
        pantryResponse(
          `Removed ${items.length} item(s) from pantry.\n\nYour pantry:\n\n${formatPantryListCompact(pantry)}`,
          pantry,
          `Removed ${items.length} item(s)`,
        ),
      );

      return result.match((response) => response, toMcpError);
    },
  );

  registerAppTool(
    ctx.server,
    "clear_pantry",
    {
      title: "Clear Pantry",
      description:
        "Deletes all saved pantry inventory for the current user. Use only when the user wants to reset pantry state completely because it removes the meal-planning context.",
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: clearPantryInputSchema,
    },
    async () => {
      const props = getProps();
      const result = await safeStorage(
        () => ctx.storage.pantry.clear(props.id),
        "clear pantry",
      ).map(() => pantryResponse("Pantry cleared successfully.", [], "Pantry cleared"));

      return result.match((response) => response, toMcpError);
    },
  );
}

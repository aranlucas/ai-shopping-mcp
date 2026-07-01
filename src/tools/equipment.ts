import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import * as z from "zod/v4";

import type { EquipmentItem } from "../utils/user-storage.js";
import type { ToolContext } from "./types.js";

import { validationError } from "../errors.js";
import { formatEquipmentListCompact } from "../utils/format-response.js";
import { getProps, safeStorage, toMcpError } from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";

const equipmentMutationItemSchema = z.object({
  equipmentName: z.string().min(1).max(200).describe("Kitchen tool or appliance name"),
  category: z
    .string()
    .max(100)
    .optional()
    .describe("Optional category such as Baking, Cooking, Utensils, or Appliances"),
});

export const addKitchenEquipmentInputSchema = z.object({
  items: z
    .array(equipmentMutationItemSchema)
    .min(1, { message: "At least one kitchen equipment item is required" })
    .describe("Kitchen equipment items to add or update by case-insensitive name"),
});

export const removeKitchenEquipmentInputSchema = z.object({
  equipmentName: z.string().min(1).max(200).describe("Kitchen equipment item to remove"),
});

export const clearKitchenEquipmentInputSchema = z.object({});

function equipmentResponse(text: string, items: EquipmentItem[], actionDetail: string) {
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: {
      _view: "kitchen_equipment" as const,
      items,
      actionDetail,
    },
  };
}

export function registerEquipmentTools(ctx: ToolContext) {
  registerAppTool(
    ctx.server,
    "add_kitchen_equipment",
    {
      title: "Add Kitchen Equipment",
      description:
        "Adds kitchen tools, appliances, and cookware the user owns so meal planning can suggest recipes that match available equipment. Existing names are updated case-insensitively.",
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: addKitchenEquipmentInputSchema,
    },
    async ({ items }) => {
      if (!items || items.length === 0) {
        return toMcpError(validationError("Error: 'items' array is required."));
      }

      const props = getProps();
      const now = new Date().toISOString();
      const result = await safeStorage(async () => {
        for (const item of items) {
          const equipmentItem: EquipmentItem = {
            equipmentName: item.equipmentName,
            category: item.category,
            addedAt: now,
          };
          await ctx.storage.equipment.add(props.id, equipmentItem);
        }
        return ctx.storage.equipment.getAll(props.id);
      }, "add equipment items").map((equipment) =>
        equipmentResponse(
          `Added ${items.length} item(s) to equipment.\n\nYour equipment:\n\n${formatEquipmentListCompact(equipment)}`,
          equipment,
          `Added ${items.length} item(s)`,
        ),
      );

      return result.match((response) => response, toMcpError);
    },
  );

  registerAppTool(
    ctx.server,
    "remove_kitchen_equipment",
    {
      title: "Remove Kitchen Equipment",
      description:
        "Removes one kitchen tool, appliance, or cookware item from the user's saved equipment inventory. Use after the user says they no longer own or can use that equipment.",
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: removeKitchenEquipmentInputSchema,
    },
    async ({ equipmentName }) => {
      if (!equipmentName) {
        return toMcpError(validationError("Error: 'equipmentName' is required."));
      }

      const props = getProps();
      const result = await safeStorage(async () => {
        await ctx.storage.equipment.remove(props.id, equipmentName);
        return ctx.storage.equipment.getAll(props.id);
      }, "remove equipment item").map((equipment) =>
        equipmentResponse(
          `Item removed from equipment.\n\nYour equipment:\n\n${formatEquipmentListCompact(equipment)}`,
          equipment,
          `Removed ${equipmentName}`,
        ),
      );

      return result.match((response) => response, toMcpError);
    },
  );

  registerAppTool(
    ctx.server,
    "clear_kitchen_equipment",
    {
      title: "Clear Kitchen Equipment",
      description:
        "Deletes all saved kitchen equipment for the current user. Use only for a deliberate full reset because meal planning will lose equipment constraints and capabilities.",
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: clearKitchenEquipmentInputSchema,
    },
    async () => {
      const props = getProps();
      const result = await safeStorage(
        () => ctx.storage.equipment.clear(props.id),
        "clear equipment",
      ).map(() =>
        equipmentResponse("Equipment cleared successfully.", [], "Kitchen equipment cleared"),
      );

      return result.match((response) => response, toMcpError);
    },
  );
}

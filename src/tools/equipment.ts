import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { errAsync } from "neverthrow";
import * as z from "zod/v4";

import type { EquipmentItem } from "../utils/user-storage.js";
import type { ToolContext } from "./types.js";

import { validationError } from "../errors.js";
import { formatEquipmentListCompact } from "../utils/format-response.js";
import { getAuthProps, requireAuth, safeStorage, toMcpResponse } from "../utils/result.js";

export function registerEquipmentTools(ctx: ToolContext) {
  registerAppTool(
    ctx.server,
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
          .describe("Name of equipment to remove (required for 'remove' action)"),
      }),
      _meta: {},
    },
    async ({ action, items, equipmentName }) => {
      const result = requireAuth(getAuthProps()).asyncAndThen((props) => {
        const { storage } = ctx;

        switch (action) {
          case "add": {
            if (!items || items.length === 0) {
              return errAsync(
                validationError("Error: 'items' array is required for the 'add' action."),
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
                validationError("Error: 'equipmentName' is required for the 'remove' action."),
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
            return safeStorage(() => storage.equipment.clear(props.id), "clear equipment").map(
              () => "Equipment cleared successfully.",
            );
        }
      });

      return toMcpResponse(await result);
    },
  );
}

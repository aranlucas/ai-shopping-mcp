import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { ResultAsync } from "neverthrow";
import * as z from "zod/v4";

import type { EquipmentItem, PantryItem } from "../utils/user-storage.js";
import type { ToolContext } from "./types.js";

import { validationError } from "../errors.js";
import { appResult } from "../app-results.js";
import {
  formatEquipmentListCompact,
  formatPantryListCompact,
  formatPreferredLocationCompact,
} from "../utils/format-response.js";
import { getProps, safeStorage, toMcpError } from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { computeFrequentlyPurchasedItems, computeRestockSuggestions } from "./recipes.js";

const addInventoryItemSchema = z.object({
  name: z.string().min(1).max(200).describe("Item name, e.g. 'Eggs' or 'Dutch oven'"),
  quantity: z.coerce.number().min(1).max(999).optional().describe("Pantry only: quantity"),
  expiresAt: z.string().optional().describe("Pantry only: ISO expiry date"),
  category: z.string().max(100).optional().describe("Equipment only: category, e.g. 'Baking'"),
});

export const addToInventoryInputSchema = z.object({
  inventory: z.enum(["pantry", "equipment"]).describe("Inventory to add to"),
  items: z
    .array(addInventoryItemSchema)
    .min(1, { message: "At least one item is required" })
    .describe("Merges by case-insensitive name"),
});

const removeInventoryItemSchema = z.object({
  name: z.string().min(1).max(200).describe("Item name to remove"),
});

export const removeFromInventoryInputSchema = z.object({
  inventory: z.enum(["pantry", "equipment"]).describe("Which inventory to remove from"),
  items: z
    .array(removeInventoryItemSchema)
    .optional()
    .describe("Items to remove by case-insensitive name"),
  all: z
    .boolean()
    .optional()
    .describe("Clear the entire inventory instead of removing specific items"),
});

function pantryResponse(text: string, items: PantryItem[], actionDetail: string) {
  return {
    content: [{ type: "text" as const, text }],
    ...appResult("pantry", {
      items,
      actionDetail,
    }),
  };
}

function equipmentResponse(text: string, items: EquipmentItem[], actionDetail: string) {
  return {
    content: [{ type: "text" as const, text }],
    ...appResult("kitchen_equipment", {
      items,
      actionDetail,
    }),
  };
}

export function registerInventoryTools(ctx: ToolContext) {
  registerAppTool(
    ctx.server,
    "add_to_inventory",
    {
      title: "Add To Inventory",
      description:
        'Adds pantry or kitchen equipment items, merging duplicate names case-insensitively. Example: {"inventory":"pantry","items":[{"name":"Eggs","quantity":12}]}',
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: addToInventoryInputSchema,
    },
    async ({ inventory, items }) => {
      if (!items || items.length === 0) {
        return toMcpError(validationError("At least one item is required in 'items'."));
      }

      getProps();
      const now = new Date().toISOString();

      if (inventory === "pantry") {
        const result = await safeStorage(
          () =>
            ctx.storage.pantry.add(
              items.map(
                (item): PantryItem => ({
                  productName: item.name,
                  quantity: item.quantity ?? 1,
                  addedAt: now,
                  expiresAt: item.expiresAt,
                }),
              ),
            ),
          "add pantry items",
        ).map((pantry) =>
          pantryResponse(
            `Added ${items.length} item(s) to pantry.\n\nYour pantry:\n\n${formatPantryListCompact(pantry)}`,
            pantry,
            `Added ${items.length} item(s)`,
          ),
        );

        return result.isOk() ? result.value : toMcpError(result.error);
      }

      const result = await safeStorage(
        () =>
          ctx.storage.equipment.add(
            items.map(
              (item): EquipmentItem => ({
                equipmentName: item.name,
                category: item.category,
                addedAt: now,
              }),
            ),
          ),
        "add equipment items",
      ).map((equipment) =>
        equipmentResponse(
          `Added ${items.length} item(s) to equipment.\n\nYour equipment:\n\n${formatEquipmentListCompact(equipment)}`,
          equipment,
          `Added ${items.length} item(s)`,
        ),
      );

      return result.isOk() ? result.value : toMcpError(result.error);
    },
  );

  registerAppTool(
    ctx.server,
    "remove_from_inventory",
    {
      title: "Remove From Inventory",
      description:
        'Removes named items from the pantry or kitchen equipment inventory, or clears it entirely with all: true. Example: {"inventory":"pantry","items":[{"name":"Eggs"}]}',
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: removeFromInventoryInputSchema,
    },
    async ({ inventory, items, all }) => {
      getProps();

      if (!all && (!items || items.length === 0)) {
        return toMcpError(
          validationError(
            "Provide items to remove (by name) or set all: true to clear the whole inventory.",
          ),
        );
      }

      if (inventory === "pantry") {
        if (all) {
          const result = await safeStorage(() => ctx.storage.pantry.clear(), "clear pantry").map(
            () => pantryResponse("Pantry cleared successfully.", [], "Pantry cleared"),
          );
          return result.isOk() ? result.value : toMcpError(result.error);
        }

        const removeItems = items ?? [];
        const result = await safeStorage(
          () => ctx.storage.pantry.remove(removeItems.map((item) => item.name)),
          "remove pantry items",
        ).map((pantry) =>
          pantryResponse(
            `Removed ${removeItems.length} item(s) from pantry.\n\nYour pantry:\n\n${formatPantryListCompact(pantry)}`,
            pantry,
            `Removed ${removeItems.length} item(s)`,
          ),
        );

        return result.isOk() ? result.value : toMcpError(result.error);
      }

      if (all) {
        const result = await safeStorage(
          () => ctx.storage.equipment.clear(),
          "clear equipment",
        ).map(() =>
          equipmentResponse("Equipment cleared successfully.", [], "Kitchen equipment cleared"),
        );
        return result.isOk() ? result.value : toMcpError(result.error);
      }

      const removeItems = items ?? [];
      const result = await safeStorage(
        () => ctx.storage.equipment.remove(removeItems.map((item) => item.name)),
        "remove equipment items",
      ).map((equipment) =>
        equipmentResponse(
          `Removed ${removeItems.length} item(s) from equipment.\n\nYour equipment:\n\n${formatEquipmentListCompact(equipment)}`,
          equipment,
          `Removed ${removeItems.length} item(s)`,
        ),
      );

      return result.isOk() ? result.value : toMcpError(result.error);
    },
  );

  ctx.server.registerTool(
    "get_shopping_profile",
    {
      title: "Get Shopping Profile",
      description:
        "Read the user's saved data: preferred store, pantry, kitchen equipment, and frequently purchased items. Call this before making personalized suggestions or answering questions like 'what's in my pantry?'.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: z.object({}),
    },
    async () => {
      getProps();

      const profileResult = await ResultAsync.combine([
        safeStorage(() => ctx.storage.preferredLocation.get(), "fetch preferred store"),
        safeStorage(() => ctx.storage.pantry.getAll(), "fetch pantry"),
        safeStorage(() => ctx.storage.equipment.getAll(), "fetch equipment"),
        safeStorage(() => ctx.storage.orderHistory.getRecent(50), "fetch order history"),
      ]);
      if (profileResult.isErr()) return toMcpError(profileResult.error);
      const [preferredStore, pantry, equipment, recentOrders] = profileResult.value;
      const parts: string[] = [];

      parts.push("## Preferred store");
      parts.push(
        preferredStore
          ? formatPreferredLocationCompact(preferredStore)
          : "none set — use search_stores + set_preferred_store",
      );

      parts.push("\n## Pantry");
      if (pantry.length === 0) {
        parts.push("empty");
      } else {
        const now = Date.now();
        for (const item of pantry) {
          let expiringNote = "";
          if (item.expiresAt) {
            const daysUntil = Math.floor(
              (new Date(item.expiresAt).getTime() - now) / (1000 * 60 * 60 * 24),
            );
            if (!Number.isNaN(daysUntil) && daysUntil <= 3) expiringNote = " (expiring soon)";
          }
          parts.push(`- ${item.productName} x${item.quantity}${expiringNote}`);
        }
      }

      parts.push("\n## Kitchen equipment");
      if (equipment.length === 0) {
        parts.push("none");
      } else {
        for (const item of equipment) {
          parts.push(`- ${item.equipmentName}${item.category ? ` (${item.category})` : ""}`);
        }
      }

      const frequentItems = computeFrequentlyPurchasedItems(recentOrders, 10);
      parts.push("\n## Frequently purchased");
      if (frequentItems.length === 0) {
        parts.push("no order history yet");
      } else {
        for (const { name, count } of frequentItems) {
          parts.push(`- ${name} (ordered ${count}x)`);
        }
      }

      const restockSuggestions = computeRestockSuggestions(recentOrders);
      parts.push("\n## Due to restock");
      if (restockSuggestions.length === 0) {
        parts.push("no restock suggestions yet");
      } else {
        for (const { name, daysSinceLast, medianIntervalDays } of restockSuggestions) {
          parts.push(
            `- ${name} (last bought ${daysSinceLast}d ago, usually every ~${medianIntervalDays}d)`,
          );
        }
      }

      return { content: [{ type: "text" as const, text: parts.join("\n") }] };
    },
  );
}

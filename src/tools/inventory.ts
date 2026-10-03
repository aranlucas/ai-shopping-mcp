import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import { ResultAsync } from "neverthrow";
import * as z from "zod/v4";

import type { EquipmentItem, PantryItem } from "../domain/shopping.js";
import type {
  EquipmentStore,
  OrderHistoryStore,
  PantryStore,
  PreferredLocationStore,
} from "../utils/shopping-store.js";

import { appResult } from "../app-results.js";
import {
  formatEquipmentListCompact,
  formatPantryListCompact,
  formatPreferredLocationCompact,
} from "../utils/format-response.js";
import { getProps, safeStorage, toMcpError } from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { classifyExpiry } from "../services/expiry.js";
import type { WeeklyDealsLoader } from "../services/weekly-deals/service.js";
import { getMealPlanningDeals } from "./meal-planning-deals.js";
import { coercedBooleanSchema, storeIdSchema } from "./schemas.js";
import {
  computeFrequentlyPurchasedItems,
  computeRestockSuggestions,
} from "../services/order-insights.js";

const pantryAddSchema = z.object({
  name: z.string().trim().min(1).max(200).describe("Item name, e.g. 'Eggs'"),
  quantity: z.coerce.number().min(1).max(999).optional().default(1),
  expiresAt: z.string().optional().describe("ISO expiry date, if known"),
});

const pantryRemoveSchema = z.object({
  name: z.string().trim().min(1).max(200),
  quantity: z.coerce
    .number()
    .min(1)
    .max(999)
    .optional()
    .describe("Amount used up; omit to remove the item entirely"),
});

const equipmentAddSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("Equipment name, e.g. 'Dutch oven'"),
  category: z.string().max(100).optional().describe("e.g. 'Baking'"),
});

export const updateInventoryInputSchema = z
  .object({
    pantry: z
      .object({
        add: z
          .array(pantryAddSchema)
          .min(1)
          .optional()
          .describe("Food bought or found; increases quantity"),
        remove: z
          .array(pantryRemoveSchema)
          .min(1)
          .optional()
          .describe(
            'Food used up or thrown out; decreases quantity ("used 6 eggs" is remove Eggs quantity 6)',
          ),
      })
      .optional()
      .describe("Food on hand. Names match case-insensitively."),
    equipment: z
      .object({
        add: z.array(equipmentAddSchema).min(1).optional(),
        remove: z
          .array(z.string().trim().min(1).max(200))
          .min(1)
          .optional()
          .describe("Equipment names to remove"),
      })
      .optional()
      .describe("Kitchen tools and appliances"),
  })
  .refine(
    (input) =>
      Boolean(
        input.pantry?.add ??
        input.pantry?.remove ??
        input.equipment?.add ??
        input.equipment?.remove,
      ),
    { message: "Pass pantry and/or equipment with add or remove items." },
  );

/**
 * Removes whole pantry items, or subtracts a quantity and removes the item
 * once none is left. Names match case-insensitively, like storage.
 */
async function consumePantryItems(
  pantry: PantryStore,
  items: Array<{ name: string; quantity?: number }>,
): Promise<PantryItem[]> {
  const partial = items.filter((item) => item.quantity !== undefined);

  const removeNames = items.flatMap((item) =>
    item.quantity === undefined ? [item.name] : [],
  );

  if (partial.length > 0) {
    const current = new Map(
      (await pantry.getAll()).map((item) => [
        item.productName.trim().toLowerCase(),
        item,
      ]),
    );

    const updates: Array<{ name: string; quantity: number }> = [];

    for (const item of partial) {
      const stored = current.get(item.name.trim().toLowerCase());

      if (!stored) continue;
      const remaining = stored.quantity - (item.quantity ?? 0);

      if (remaining > 0) updates.push({ name: item.name, quantity: remaining });
      else removeNames.push(item.name);
    }

    await Promise.all(
      updates.map((update) =>
        pantry.updateQuantity(update.name, update.quantity),
      ),
    );
  }

  return removeNames.length > 0 ? pantry.remove(removeNames) : pantry.getAll();
}

function pantryResponse(
  text: string,
  items: PantryItem[],
  actionDetail: string,
) {
  return {
    content: [{ type: "text" as const, text }],
    ...appResult("pantry", {
      items,
      actionDetail,
    }),
  };
}

function equipmentResponse(
  text: string,
  items: EquipmentItem[],
  actionDetail: string,
) {
  return {
    content: [{ type: "text" as const, text }],
    ...appResult("kitchen_equipment", {
      items,
      actionDetail,
    }),
  };
}

export type InventoryToolDependencies = {
  loadWeeklyDeals: WeeklyDealsLoader;
  equipment: EquipmentStore;
  orderHistory: OrderHistoryStore;
  pantry: PantryStore;
  preferredLocation: PreferredLocationStore;
};

export function registerInventoryTools(
  server: McpServer,
  {
    loadWeeklyDeals,
    equipment,
    orderHistory,
    pantry,
    preferredLocation,
  }: InventoryToolDependencies,
): void {
  registerAppTool(
    server,
    "update_inventory",
    {
      title: "Update Inventory",
      description:
        'Updates the pantry and kitchen equipment in one call. pantry.add is for food bought; pantry.remove is for food used up, subtracting its quantity or removing the item when quantity is omitted. Example for "used 6 eggs and finished the milk": {"pantry":{"remove":[{"name":"Eggs","quantity":6},{"name":"Milk"}]}}',
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: updateInventoryInputSchema,
    },
    async ({ pantry: pantryChanges, equipment: equipmentChanges }) => {
      getProps();
      const now = new Date().toISOString();
      const summary: string[] = [];

      let pantryItems: PantryItem[] | undefined;

      if (pantryChanges?.add) {
        const additions = pantryChanges.add;

        const added = await safeStorage(
          () =>
            pantry.add(
              additions.map((item): PantryItem => ({
                productName: item.name,
                quantity: item.quantity,
                addedAt: now,
                expiresAt: item.expiresAt,
              })),
            ),
          "add pantry items",
        );

        if (added.isErr()) return toMcpError(added.error);
        pantryItems = added.value;
        summary.push(`Added ${additions.length} pantry item(s).`);
      }

      if (pantryChanges?.remove) {
        const removals = pantryChanges.remove;

        const removed = await safeStorage(
          () => consumePantryItems(pantry, removals),
          "remove pantry items",
        );

        if (removed.isErr()) return toMcpError(removed.error);
        pantryItems = removed.value;
        summary.push(`Used or removed ${removals.length} pantry item(s).`);
      }

      let equipmentItems: EquipmentItem[] | undefined;

      if (equipmentChanges?.add) {
        const additions = equipmentChanges.add;

        const added = await safeStorage(
          () =>
            equipment.add(
              additions.map((item): EquipmentItem => ({
                equipmentName: item.name,
                category: item.category,
                addedAt: now,
              })),
            ),
          "add equipment items",
        );

        if (added.isErr()) return toMcpError(added.error);
        equipmentItems = added.value;
        summary.push(`Added ${additions.length} equipment item(s).`);
      }

      if (equipmentChanges?.remove) {
        const names = equipmentChanges.remove;

        const removed = await safeStorage(
          () => equipment.remove(names),
          "remove equipment items",
        );

        if (removed.isErr()) return toMcpError(removed.error);
        equipmentItems = removed.value;
        summary.push(`Removed ${names.length} equipment item(s).`);
      }

      const sections = [summary.join(" ")];

      if (pantryItems) {
        sections.push(`Pantry now:\n${formatPantryListCompact(pantryItems)}`);
      }

      if (equipmentItems) {
        sections.push(
          `Equipment now:\n${formatEquipmentListCompact(equipmentItems)}`,
        );
      }

      const text = sections.join("\n\n");
      const actionDetail = summary.join(" ");

      return pantryItems
        ? pantryResponse(text, pantryItems, actionDetail)
        : equipmentResponse(text, equipmentItems ?? [], actionDetail);
    },
  );

  server.registerTool(
    "get_shopping_profile",
    {
      title: "Get Shopping Profile",
      description:
        "Reads everything saved about the household: preferred store, pantry (soonest-expiring first), kitchen equipment, frequently purchased items, and items due to restock. Call it before personalized suggestions, meal planning, or questions like 'what's in my pantry?'. Set includeWeeklyDeals for meal planning around sales.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: z.object({
        includeWeeklyDeals: coercedBooleanSchema
          .optional()
          .default(false)
          .describe("Also include up to 10 of this week's deals"),
        storeId: storeIdSchema
          .optional()
          .describe("Store for weekly deals; defaults to the preferred store"),
      }),
    },
    async ({ includeWeeklyDeals, storeId }) => {
      getProps();

      const [profileResult, weeklyDeals] = await Promise.all([
        ResultAsync.combine([
          safeStorage(() => preferredLocation.get(), "fetch preferred store"),
          safeStorage(() => pantry.getAll(), "fetch pantry"),
          safeStorage(() => equipment.getAll(), "fetch equipment"),
          safeStorage(() => orderHistory.getRecent(50), "fetch order history"),
        ]),
        includeWeeklyDeals
          ? getMealPlanningDeals(loadWeeklyDeals, storeId)
          : Promise.resolve(undefined),
      ]);

      if (profileResult.isErr()) return toMcpError(profileResult.error);

      const [preferredStore, pantryItems, equipmentItems, recentOrders] =
        profileResult.value;

      const now = Date.now();

      const pantryView = pantryItems
        .map((item) => {
          const expiry = classifyExpiry(item.expiresAt, now);

          return {
            name: item.productName,
            quantity: item.quantity,
            expiresAt: item.expiresAt,
            expiry: expiry.status,
            daysUntil: "daysUntil" in expiry ? expiry.daysUntil : undefined,
          };
        })
        .toSorted(
          (a, b) =>
            (a.daysUntil ?? Number.POSITIVE_INFINITY) -
            (b.daysUntil ?? Number.POSITIVE_INFINITY),
        );

      const frequentItems = computeFrequentlyPurchasedItems(recentOrders, 10);
      const restockSuggestions = computeRestockSuggestions(recentOrders);

      const parts: string[] = [
        `Preferred store: ${
          preferredStore
            ? formatPreferredLocationCompact(preferredStore)
            : "none set; use search_stores + set_preferred_store"
        }`,
        "",
        "Pantry:",
      ];

      if (pantryView.length === 0) parts.push("- empty");

      for (const item of pantryView) {
        const note =
          item.expiry === "expired"
            ? ` (expired ${item.expiresAt})`
            : item.expiry === "today"
              ? " (expires today)"
              : item.expiresAt
                ? ` (expires ${item.expiresAt}${item.expiry === "soon" ? ", use soon" : ""})`
                : "";

        parts.push(`- ${item.name} x${item.quantity}${note}`);
      }

      parts.push("", "Kitchen equipment:");

      if (equipmentItems.length === 0) parts.push("- none");

      for (const item of equipmentItems) {
        parts.push(
          `- ${item.equipmentName}${item.category ? ` (${item.category})` : ""}`,
        );
      }

      parts.push("", "Frequently purchased:");

      if (frequentItems.length === 0) parts.push("- no order history yet");

      for (const { name, count } of frequentItems) {
        parts.push(`- ${name} (ordered ${count}x)`);
      }

      parts.push("", "Due to restock:");

      if (restockSuggestions.length === 0) parts.push("- nothing due");

      for (const {
        name,
        daysSinceLast,
        medianIntervalDays,
      } of restockSuggestions) {
        parts.push(
          `- ${name} (last bought ${daysSinceLast}d ago, usually every ~${medianIntervalDays}d)`,
        );
      }

      if (weeklyDeals) parts.push(weeklyDeals);

      return {
        content: [{ type: "text" as const, text: parts.join("\n") }],
        structuredContent: {
          preferredStore: preferredStore ?? null,
          pantry: pantryView.map((item) => ({
            name: item.name,
            quantity: item.quantity,
            expiresAt: item.expiresAt,
            expiry: item.expiry,
          })),
          equipment: equipmentItems.map((item) => ({
            name: item.equipmentName,
            category: item.category,
          })),
          frequentlyPurchased: frequentItems,
          restock: restockSuggestions,
        },
      };
    },
  );
}

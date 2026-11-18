import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import { ResultAsync } from "neverthrow";
import * as z from "zod/v4";

import type { EquipmentItem, PantryItem } from "../domain/shopping.js";
import type {
  ShoppingStore,
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
import { getProps } from "../utils/request-identity.js";
import { safeStorage } from "../utils/result.js";
import { toMcpError } from "../utils/mcp-result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { classifyExpiry } from "../services/expiry.js";
import type { WeeklyDealsLoader } from "../services/weekly-deals/service.js";
import { getMealPlanningDeals } from "./meal-planning-deals.js";
import { coercedBooleanSchema } from "./schemas.js";
import { MAX_INVENTORY_BATCH, storeIdSchema } from "../domain/shopping-schemas.js";
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
  name: z.string().trim().min(1).max(200).describe("Equipment name, e.g. 'Dutch oven'"),
  category: z.string().max(100).optional().describe("e.g. 'Baking'"),
});

export const updateInventoryInputSchema = z
  .object({
    pantry: z
      .object({
        add: z
          .array(pantryAddSchema)
          .min(1)
          .max(MAX_INVENTORY_BATCH)
          .optional()
          .describe("Food bought or found; increases quantity"),
        remove: z
          .array(pantryRemoveSchema)
          .min(1)
          .max(MAX_INVENTORY_BATCH)
          .optional()
          .describe(
            'Food used up or thrown out; decreases quantity ("used 6 eggs" is remove Eggs quantity 6)',
          ),
      })
      .optional()
      .describe("Food on hand. Names match case-insensitively."),
    equipment: z
      .object({
        add: z.array(equipmentAddSchema).min(1).max(MAX_INVENTORY_BATCH).optional(),
        remove: z
          .array(z.string().trim().min(1).max(200))
          .min(1)
          .max(MAX_INVENTORY_BATCH)
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

export type InventoryToolDependencies = {
  updateInventory: ShoppingStore["updateInventory"];
  loadWeeklyDeals: WeeklyDealsLoader;
  equipment: EquipmentStore;
  orderHistory: OrderHistoryStore;
  pantry: PantryStore;
  preferredLocation: PreferredLocationStore;
};

export function registerInventoryTools(
  server: McpServer,
  {
    updateInventory,
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
        "Update pantry and equipment together. Add food to increase stock. Remove food with a quantity to subtract that amount, or omit the quantity to remove it entirely.",
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

      const addPantry = (pantryChanges?.add ?? []).map(({ name, quantity, expiresAt }) => ({
        productName: name,
        quantity,
        expiresAt,
        addedAt: now,
      }));

      const consumePantry = pantryChanges?.remove ?? [];

      const addEquipment = (equipmentChanges?.add ?? []).map(({ name, category }) => ({
        equipmentName: name,
        category,
        addedAt: now,
      }));

      const removeEquipment = equipmentChanges?.remove ?? [];

      const updated = await safeStorage(
        () => updateInventory({ addPantry, consumePantry, addEquipment, removeEquipment }),
        "update inventory",
      );

      if (updated.isErr()) {
        return toMcpError(updated.error);
      }

      const summary = [
        addPantry.length && `Added ${addPantry.length} pantry item(s).`,
        consumePantry.length && `Used or removed ${consumePantry.length} pantry item(s).`,
        addEquipment.length && `Added ${addEquipment.length} equipment item(s).`,
        removeEquipment.length && `Removed ${removeEquipment.length} equipment item(s).`,
      ].filter(Boolean);

      const pantryItems =
        addPantry.length || consumePantry.length ? updated.value.pantry : undefined;

      const equipmentItems =
        addEquipment.length || removeEquipment.length ? updated.value.equipment : undefined;

      const sections = [summary.join(" ")];

      if (pantryItems) {
        sections.push(`Pantry now:\n${formatPantryListCompact(pantryItems)}`);
      }

      if (equipmentItems) {
        sections.push(`Equipment now:\n${formatEquipmentListCompact(equipmentItems)}`);
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
        "Read the preferred store, pantry by expiry, equipment, frequent purchases, and restock suggestions. Use before personalized shopping or meal planning. Set includeWeeklyDeals to plan around sales.",
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

      if (profileResult.isErr()) {
        return toMcpError(profileResult.error);
      }

      const [preferredStore, pantryItems, equipmentItems, recentOrders] = profileResult.value;

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
            (a.daysUntil ?? Number.POSITIVE_INFINITY) - (b.daysUntil ?? Number.POSITIVE_INFINITY),
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

      if (pantryView.length === 0) {
        parts.push("- empty");
      }

      for (const item of pantryView) {
        const note =
          item.expiry === "expired"
            ? ` (expired ${String(item.expiresAt)})`
            : item.expiry === "today"
              ? " (expires today)"
              : item.expiresAt
                ? ` (expires ${item.expiresAt}${item.expiry === "soon" ? ", use soon" : ""})`
                : "";

        parts.push(`- ${item.name} x${item.quantity}${note}`);
      }

      parts.push("", "Kitchen equipment:");

      if (equipmentItems.length === 0) {
        parts.push("- none");
      }

      for (const item of equipmentItems) {
        parts.push(`- ${item.equipmentName}${item.category ? ` (${item.category})` : ""}`);
      }

      parts.push("", "Frequently purchased:");

      if (frequentItems.length === 0) {
        parts.push("- no order history yet");
      }

      for (const { name, count } of frequentItems) {
        parts.push(`- ${name} (ordered ${count}x)`);
      }

      parts.push("", "Due to restock:");

      if (restockSuggestions.length === 0) {
        parts.push("- nothing due");
      }

      for (const { name, daysSinceLast, medianIntervalDays } of restockSuggestions) {
        parts.push(
          `- ${name} (last bought ${daysSinceLast}d ago, usually every ~${medianIntervalDays}d)`,
        );
      }

      if (weeklyDeals) {
        parts.push(weeklyDeals);
      }

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

import { ResultAsync } from "neverthrow";
import * as z from "zod/v4";

import type { OrderRecord } from "../utils/user-storage.js";

import { getProps, safeStorage, toMcpError } from "../utils/result.js";
import { type ToolContext, textResult } from "./types.js";

/**
 * Ranks item names by purchase frequency across recent orders. Shared by
 * `get_meal_planning_context` and `get_shopping_profile` so both surface the
 * same "frequently purchased" signal.
 */
export function computeFrequentlyPurchasedItems(
  recentOrders: OrderRecord[],
  limit = 10,
): Array<{ name: string; count: number }> {
  const itemFrequency = new Map<string, number>();
  for (const order of recentOrders) {
    for (const item of order.items) {
      const name = item.productName.toLowerCase();
      itemFrequency.set(name, (itemFrequency.get(name) ?? 0) + 1);
    }
  }
  return [...itemFrequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

export type RestockSuggestion = {
  name: string;
  daysSinceLast: number;
  medianIntervalDays: number;
};

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Replenishment: for each product name (case-insensitive) with at least 3
 * purchases in order history, computes the median interval between
 * consecutive purchases and flags items overdue relative to that interval —
 * i.e. `now - lastPurchase > medianInterval`. Sorted most-overdue first,
 * capped at 5. See docs/small-model-efficiency-plan.md Phase 3 item 7.
 */
export function computeRestockSuggestions(
  orders: OrderRecord[],
  now: number = Date.now(),
): RestockSuggestion[] {
  const purchasesByName = new Map<string, { displayName: string; timestamps: number[] }>();

  for (const order of orders) {
    const placedAt = new Date(order.placedAt).getTime();
    if (Number.isNaN(placedAt)) continue;

    for (const item of order.items) {
      const key = item.productName.toLowerCase();
      const existing = purchasesByName.get(key);
      if (existing) {
        existing.timestamps.push(placedAt);
      } else {
        purchasesByName.set(key, { displayName: item.productName, timestamps: [placedAt] });
      }
    }
  }

  const suggestions: RestockSuggestion[] = [];

  for (const { displayName, timestamps } of purchasesByName.values()) {
    if (timestamps.length < 3) continue;

    const sorted = [...timestamps].sort((a, b) => a - b);
    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      intervals.push(sorted[i] - sorted[i - 1]);
    }

    const medianIntervalMs = median(intervals);
    const lastPurchase = sorted[sorted.length - 1];
    const sinceLastMs = now - lastPurchase;

    if (sinceLastMs > medianIntervalMs) {
      suggestions.push({
        name: displayName,
        daysSinceLast: Math.floor(sinceLastMs / MS_PER_DAY),
        medianIntervalDays: Math.round(medianIntervalMs / MS_PER_DAY),
      });
    }
  }

  // Most-overdue first: rank by how many days past the median interval the
  // item is, not raw days-since-last (a rarely-bought item with a long
  // interval shouldn't outrank a frequently-bought item that's well overdue).
  suggestions.sort((a, b) => {
    const overdueA = a.daysSinceLast - a.medianIntervalDays;
    const overdueB = b.daysSinceLast - b.medianIntervalDays;
    return overdueB - overdueA;
  });
  return suggestions.slice(0, 5);
}

const mealPlanningInputSchema = z.object({
  numberOfMeals: z
    .number()
    .min(1)
    .max(7)
    .optional()
    .default(3)
    .describe("Number of meal suggestions the host model should generate (1-7)"),
  mealType: z
    .enum(["any", "breakfast", "lunch", "dinner", "snack"])
    .optional()
    .default("any")
    .describe("Type of meals the user wants"),
  dietaryPreferences: z
    .string()
    .max(300)
    .optional()
    .describe("Dietary preferences or restrictions such as vegetarian, low-carb, or gluten-free"),
  prioritizeExpiring: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether the host model should prioritize ingredients expiring soon"),
});

export function registerRecipeTools(ctx: ToolContext) {
  ctx.server.registerTool(
    "get_meal_planning_context",
    {
      title: "Get Meal Planning Context",
      description:
        "Returns pantry, expiry, kitchen equipment, and recent-order context for the host model to write meal suggestions. This tool does not call an LLM or render an app view; it supplies structured context and guidance.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: mealPlanningInputSchema,
    },
    async ({ numberOfMeals, mealType, dietaryPreferences, prioritizeExpiring }) => {
      const { storage } = ctx;
      const props = getProps();

      return ResultAsync.combine([
        safeStorage(() => storage.pantry.getAll(props.id), "fetch pantry"),
        safeStorage(() => storage.equipment.getAll(props.id), "fetch equipment"),
        safeStorage(() => storage.orderHistory.getRecent(props.id, 10), "fetch order history"),
      ]).match(([pantry, equipment, recentOrders]) => {
        if (pantry.length === 0) {
          return textResult(
            'Your pantry is empty. Add items first using add_to_inventory, e.g. {"inventory":"pantry","items":[{"name":"Eggs"}]}, then try planning meals again.',
          );
        }

        const now = Date.now();
        const categorizedPantry = pantry.map((item) => {
          if (!item.expiresAt) return { ...item, urgency: "none" as const, daysUntil: undefined };
          const expiresAtMs = new Date(item.expiresAt).getTime();
          if (Number.isNaN(expiresAtMs)) {
            return { ...item, urgency: "none" as const, daysUntil: undefined };
          }
          const daysUntil = Math.floor((expiresAtMs - now) / (1000 * 60 * 60 * 24));
          if (daysUntil < 0) return { ...item, urgency: "expired" as const, daysUntil };
          if (daysUntil <= 1) return { ...item, urgency: "critical" as const, daysUntil };
          if (daysUntil <= 3) return { ...item, urgency: "warning" as const, daysUntil };
          return { ...item, urgency: "ok" as const, daysUntil };
        });

        const expiringItems = categorizedPantry.filter(
          (item) => item.urgency === "critical" || item.urgency === "warning",
        );
        const expiredItems = categorizedPantry.filter((item) => item.urgency === "expired");
        const availableItems = categorizedPantry.filter((item) => item.urgency !== "expired");

        const parts: string[] = [
          `**Meal Plan** (${numberOfMeals} meal${numberOfMeals > 1 ? "s" : ""}${mealType !== "any" ? ` - ${mealType}` : ""})`,
        ];

        if (expiredItems.length > 0) {
          parts.push(
            `\n❌ ${expiredItems.length} expired item(s) excluded: ${expiredItems.map((i) => i.productName).join(", ")}`,
          );
        }

        if (dietaryPreferences) {
          parts.push(`\nDietary preferences: ${dietaryPreferences}`);
        }

        if (prioritizeExpiring && expiringItems.length > 0) {
          parts.push("\n**⚠️ Expiring Soon (use first!):**");
          for (const item of expiringItems) {
            const urgency = item.urgency === "critical" ? "TODAY/TOMORROW" : "2-3 days";
            parts.push(`- ${item.productName} x${item.quantity} (${urgency})`);
          }
        }

        parts.push(`\n**Pantry (${availableItems.length} items):**`);
        for (const item of availableItems) {
          parts.push(`- ${item.productName} x${item.quantity}`);
        }

        if (equipment.length > 0) {
          parts.push(`\n**Equipment (${equipment.length} items):**`);
          for (const item of equipment) {
            parts.push(`- ${item.equipmentName}${item.category ? ` (${item.category})` : ""}`);
          }
        }

        if (recentOrders.length > 0) {
          const frequentItems = computeFrequentlyPurchasedItems(recentOrders, 10);
          if (frequentItems.length > 0) {
            parts.push("\n**Frequently Purchased (user preferences):**");
            for (const { name, count } of frequentItems) {
              parts.push(`- ${name} (ordered ${count}x)`);
            }
          }
        }

        parts.push(
          `\n---\n**Action Required:** Suggest ${numberOfMeals} meal(s)${mealType !== "any" ? ` for ${mealType}` : ""} using the pantry items above.`,
          "For each meal, include: name, description, pantry ingredients used (flag expiring ones), additional ingredients to buy, cooking steps, and estimated time.",
          prioritizeExpiring ? "Prioritize using expiring items first to reduce food waste." : "",
          "After suggesting meals, offer to add any missing ingredients to a shopping list using create_shopping_list.",
        );

        return {
          content: [{ type: "text" as const, text: parts.filter(Boolean).join("\n") }],
          structuredContent: {
            request: {
              numberOfMeals,
              mealType,
              dietaryPreferences,
              prioritizeExpiring,
            },
            pantry: categorizedPantry,
            equipment,
            recentOrders,
          },
        };
      }, toMcpError);
    },
  );
}

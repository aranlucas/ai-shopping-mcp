import { ResultAsync } from "neverthrow";
import * as z from "zod/v4";

import { getProps, safeStorage, toMcpError } from "../utils/result.js";
import { type ToolContext, textResult } from "./types.js";

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
            "Your pantry is empty. Add items to your pantry first using add_pantry_items, then try planning meals again.",
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
          const itemFrequency = new Map<string, number>();
          for (const order of recentOrders) {
            for (const item of order.items) {
              const name = item.productName.toLowerCase();
              itemFrequency.set(name, (itemFrequency.get(name) ?? 0) + 1);
            }
          }
          const frequentItems = [...itemFrequency.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);
          if (frequentItems.length > 0) {
            parts.push("\n**Frequently Purchased (user preferences):**");
            for (const [name, count] of frequentItems) {
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

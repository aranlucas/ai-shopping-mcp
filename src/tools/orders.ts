import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { OrderRecord } from "../domain/shopping.js";
import type { OrderHistoryStore } from "../utils/shopping-store.js";

import { appResult } from "../app-results.js";
import { formatOrderHistoryCompact } from "../utils/format-response.js";
import { getProps, safeStorage, toMcpError } from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { storeIdSchema, upcSchema } from "./schemas.js";

const orderItemSchema = z.strictObject({
  upc: upcSchema.describe("13-digit UPC from search_products"),
  productName: z.string().max(200),
  quantity: z.coerce.number().int().min(1).max(999),
  price: z.coerce.number().min(0).optional(),
});

export const recordOrderInputSchema = z.object({
  items: z
    .array(orderItemSchema)
    .min(1, { message: "At least one ordered item is required" })
    .describe("Items that were actually purchased in the completed order"),
  storeId: storeIdSchema
    .optional()
    .describe("8-character storeId from search_stores"),
  notes: z.string().max(500).optional(),
});

export type OrderToolDependencies = {
  orderHistory: OrderHistoryStore;
};

export function registerOrderTools(
  server: McpServer,
  { orderHistory }: OrderToolDependencies,
): void {
  registerAppTool(
    server,
    "record_order",
    {
      title: "Record Completed Order",
      description:
        "Records the groceries the user actually purchased as order history. This supports future preference context, frequently purchased items, and meal planning based on recent shopping behavior.",
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: recordOrderInputSchema,
    },
    async ({ items, storeId, notes }) => {
      getProps();
      const orderId = `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
      const estimatedTotal = items.reduce(
        (sum, item) => sum + (item.price || 0) * item.quantity,
        0,
      );

      const order: OrderRecord = {
        orderId,
        items,
        totalItems,
        estimatedTotal: estimatedTotal > 0 ? estimatedTotal : undefined,
        placedAt: new Date().toISOString(),
        locationId: storeId,
        notes,
      };

      const result = await safeStorage(
        () => orderHistory.add(order),
        "record order",
      ).map(() =>
        Object.assign(
          {
            content: [
              {
                type: "text" as const,
                text: `Order recorded successfully:\n\n${formatOrderHistoryCompact([order])}`,
              },
            ],
          },
          appResult("record_order", {
            orderId: order.orderId,
            items: order.items,
            totalItems: order.totalItems,
            estimatedTotal: order.estimatedTotal,
            placedAt: order.placedAt,
            locationId: order.locationId,
            notes: order.notes,
          }),
        ),
      );

      return result.isOk() ? result.value : toMcpError(result.error);
    },
  );
}

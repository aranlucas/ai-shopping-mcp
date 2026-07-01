import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import * as z from "zod/v4";

import type { OrderRecord } from "../utils/user-storage.js";
import type { ToolContext } from "./types.js";

import { formatOrderHistoryCompact } from "../utils/format-response.js";
import { getProps, safeStorage, toMcpError } from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";

const orderItemSchema = z.object({
  productId: z.string().describe("13-digit product UPC or Kroger product identifier"),
  productName: z.string().max(200),
  quantity: z.number().min(1).max(999),
  price: z.number().min(0).optional(),
});

export const recordOrderInputSchema = z.object({
  items: z
    .array(orderItemSchema)
    .min(1, { message: "At least one ordered item is required" })
    .describe("Items that were actually purchased in the completed order"),
  locationId: z
    .string()
    .length(8, { message: "Location ID must be exactly 8 characters" })
    .optional(),
  notes: z.string().max(500).optional(),
});

export function registerOrderTools(ctx: ToolContext) {
  registerAppTool(
    ctx.server,
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
    async ({ items, locationId, notes }) => {
      const props = getProps();
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
        locationId,
        notes,
      };

      const result = await safeStorage(
        () => ctx.storage.orderHistory.add(props.id, order),
        "record order",
      ).map(() => ({
        content: [
          {
            type: "text" as const,
            text: `Order recorded successfully:\n\n${formatOrderHistoryCompact([order])}`,
          },
        ],
        structuredContent: {
          _view: "record_order" as const,
          orderId: order.orderId,
          items: order.items,
          totalItems: order.totalItems,
          estimatedTotal: order.estimatedTotal,
          placedAt: order.placedAt,
          locationId: order.locationId,
          notes: order.notes,
        },
      }));

      return result.match((response) => response, toMcpError);
    },
  );
}

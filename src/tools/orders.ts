import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import * as z from "zod/v4";

import type { OrderRecord } from "../utils/user-storage.js";
import type { ToolContext } from "./types.js";

import { formatOrderHistoryCompact } from "../utils/format-response.js";
import { getProps, safeStorage, toMcpResponse } from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";

export function registerOrderTools(ctx: ToolContext) {
  registerAppTool(
    ctx.server,
    "mark_order_placed",
    {
      title: "Record Order",
      description:
        "Records a completed order in your order history for tracking purchases over time.",
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: z.object({
        items: z.array(
          z.object({
            productId: z.string(),
            productName: z.string().max(200),
            quantity: z.number().min(1).max(999),
            price: z.number().min(0).optional(),
          }),
        ),
        locationId: z.string().optional(),
        notes: z.string().max(500).optional(),
      }),
    },
    async ({ items, locationId, notes }) => {
      const props = getProps();
      const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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

      const result = safeStorage(
        () => ctx.storage.orderHistory.add(props.id, order),
        "record order",
      ).map(() => `Order recorded successfully:\n\n${formatOrderHistoryCompact([order])}`);

      return toMcpResponse(await result);
    },
  );
}

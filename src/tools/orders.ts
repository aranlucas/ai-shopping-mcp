import * as z from "zod/v4";

import type { OrderRecord } from "../utils/user-storage.js";
import type { ToolContext } from "./types.js";

import { appResult } from "../app-results.js";
import { parseProductReference } from "../services/catalog/types.js";
import { formatOrderHistoryCompact } from "../utils/format-response.js";
import { getProps, safeStorage, toMcpError } from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { storeIdSchema, upcSchema } from "./schemas.js";

const orderItemSchema = z
  .object({
    productRef: z
      .string()
      .trim()
      .refine((value) => parseProductReference(value) !== null)
      .optional()
      .describe("productRef from search_products"),
    upc: upcSchema.optional().describe("Deprecated Kroger UPC compatibility input"),
    productName: z.string().max(200),
    quantity: z.coerce.number().min(1).max(999),
    price: z.coerce.number().min(0).optional(),
  })
  .refine((item) => Boolean(item.productRef ?? item.upc), {
    message: "Each ordered item needs a productRef.",
  });

export const recordOrderInputSchema = z.object({
  items: z
    .array(orderItemSchema)
    .min(1, { message: "At least one ordered item is required" })
    .describe("Items that were actually purchased in the completed order"),
  storeId: storeIdSchema.optional().describe("8-character storeId from search_stores"),
  notes: z.string().max(500).optional(),
});

export function registerOrderTools(ctx: ToolContext) {
  ctx.server.registerTool(
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

      const orderItems = items.map(({ productRef, upc, ...item }) => {
        const product = productRef
          ? parseProductReference(productRef)
          : upc
            ? { provider: "kroger", id: upc }
            : null;
        return {
          ...item,
          ...(product === null ? {} : { product }),
          ...(product?.provider === "kroger" ? { upc: product.id } : {}),
        };
      });

      const order: OrderRecord = {
        orderId,
        items: orderItems,
        totalItems,
        estimatedTotal: estimatedTotal > 0 ? estimatedTotal : undefined,
        placedAt: new Date().toISOString(),
        locationId: storeId,
        notes,
      };

      const result = await safeStorage(
        () => ctx.storage.orderHistory.add(order),
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

import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { OrderRecord } from "../domain/shopping.js";
import type { OrderHistoryStore, PreferredLocationStore } from "../utils/shopping-store.js";

import { appResult } from "../app-results.js";
import { formatShoppingListItemCompact } from "../utils/format-response.js";
import { getProps } from "../utils/request-identity.js";
import { safeStorage } from "../utils/result.js";
import { toMcpError } from "../utils/mcp-result.js";
import { validationError } from "../errors.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { MAX_ITEM_BATCH, storeIdSchema, upcSchema } from "../domain/shopping-schemas.js";

const orderItemSchema = z.strictObject({
  upc: upcSchema.optional().describe("13-digit UPC from search_products, if known"),
  productName: z.string().trim().min(1).max(200),
  quantity: z.coerce.number().int().min(1).max(999).default(1),
  price: z.coerce.number().min(0).optional(),
});

export const recordOrderInputSchema = z.object({
  items: z
    .array(orderItemSchema)
    .min(1, { message: "At least one ordered item is required" })
    .max(MAX_ITEM_BATCH)
    .describe("Items that were actually purchased in the completed order"),
  storeId: storeIdSchema
    .optional()
    .describe(
      "8-character storeId from search_stores; defaults to the preferred store. Put a store name in notes if its ID is unknown.",
    ),
  notes: z.string().max(500).optional(),
  orderId: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe(
      "Stable ID for this purchase, such as the Kroger order number. Retrying with the same orderId records the order once.",
    ),
});

export type OrderToolDependencies = {
  orderHistory: OrderHistoryStore;
  preferredLocation: PreferredLocationStore;
};

export function registerOrderTools(
  server: McpServer,
  { orderHistory, preferredLocation }: OrderToolDependencies,
): void {
  registerAppTool(
    server,
    "record_order",
    {
      title: "Record Completed Order",
      description:
        'Records a completed purchase in order history; does not place an order or update the pantry. Pass orderId (e.g. the Kroger order number) so a retry after a lost response does not record it twice. Product names are enough: no search needed for unknown UPCs. storeId defaults to the preferred store; put a different store name in notes if its ID is unknown. Example: {"items":[{"productName":"Milk","quantity":2}]}',
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: recordOrderInputSchema,
    },
    async ({ items, storeId, notes, orderId: requestedOrderId }) => {
      getProps();

      const locationId =
        storeId ??
        (await safeStorage(() => preferredLocation.get(), "fetch preferred store").match(
          (store) => store?.locationId,
          (): undefined => undefined,
        ));

      const orderId = requestedOrderId ?? `ORD-${crypto.randomUUID()}`;
      const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);

      const estimatedTotal = items.reduce(
        (sum, item) => sum + (item.price ?? 0) * item.quantity,
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

      const result = await safeStorage(() => orderHistory.add(order), "record order");

      if (result.isErr()) {
        return toMcpError(result.error);
      }

      const { record, created } = result.value;

      if (!created && JSON.stringify(record.items) !== JSON.stringify(items)) {
        return toMcpError(
          validationError(
            `orderId=${orderId} is already recorded with different items. Use a new orderId for a different purchase.`,
          ),
        );
      }

      const pricedLines = record.items.filter((item) => item.price !== undefined).length;

      const summary = `orderId=${record.orderId} | ${record.items.length} line item(s), ${record.totalItems} package(s)`;

      return Object.assign(
        {
          content: [
            {
              type: "text" as const,
              text: [
                created
                  ? `Order recorded successfully: ${summary}`
                  : `Order already recorded: ${summary}. Nothing was added.`,
                ...(record.locationId ? [`storeId=${record.locationId}`] : []),
                ...(record.estimatedTotal === undefined
                  ? []
                  : [
                      `Estimated total: $${record.estimatedTotal.toFixed(2)} (${pricedLines}/${record.items.length} lines priced)`,
                    ]),
                ...record.items.map((item) => `- ${formatShoppingListItemCompact(item)}`),
                ...(record.notes ? [`Notes: ${record.notes}`] : []),
              ].join("\n"),
            },
          ],
        },
        appResult("record_order", {
          orderId: record.orderId,
          items: record.items,
          totalItems: record.totalItems,
          estimatedTotal: record.estimatedTotal,
          placedAt: record.placedAt,
          locationId: record.locationId,
          notes: record.notes,
        }),
      );
    },
  );
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatOrderHistoryCompact } from "../utils/format-response.js";
import { createUserStorage, type OrderRecord } from "../utils/user-storage.js";

// Context from the auth process, encrypted & stored in the auth token
type Props = {
  id: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt: number;
  krogerClientId: string;
  krogerClientSecret: string;
};

/**
 * Registers order history tracking tools with the MCP server.
 *
 * Tools:
 * - mark_order_placed: Record a completed order
 * - view_order_history: Display past orders
 */
export function registerOrderTools(
  server: McpServer,
  env: Env,
  getProps: () => Props | undefined,
) {
  // Mark order placed tool
  server.registerTool(
    "mark_order_placed",
    {
      description:
        "Records a completed order in your order history. Use this after successfully placing an order to track your purchases over time.",
      inputSchema: z.object({
        items: z.array(
          z.object({
            productId: z.string(),
            productName: z.string(),
            quantity: z.number().min(1),
            price: z.number().optional(),
          }),
        ),
        locationId: z.string().optional(),
        notes: z.string().optional(),
      }),
    },
    async ({ items, locationId, notes }) => {
      const props = getProps();
      if (!props?.id) {
        throw new Error("User not authenticated");
      }

      const storage = createUserStorage(env.USER_DATA_KV);

      // Generate order ID with timestamp
      const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
      const estimatedTotal = items.reduce((sum, item) => {
        return sum + (item.price || 0) * item.quantity;
      }, 0);

      const order: OrderRecord = {
        orderId,
        items,
        totalItems,
        estimatedTotal: estimatedTotal > 0 ? estimatedTotal : undefined,
        placedAt: new Date().toISOString(),
        locationId,
        notes,
      };

      await storage.orderHistory.add(props.id, order);

      const formatted = formatOrderHistoryCompact([order]);

      return {
        content: [
          {
            type: "text",
            text: `Order recorded successfully:\n\n${formatted}`,
          },
        ],
      };
    },
  );

  // View order history tool
  server.registerTool(
    "view_order_history",
    {
      description:
        "Displays your past order history. Use this to see previous purchases and track shopping patterns. Returns most recent orders first.",
      inputSchema: z.object({
        limit: z
          .number()
          .min(1)
          .max(50)
          .optional()
          .default(10)
          .describe("Number of recent orders to display"),
      }),
    },
    async ({ limit }) => {
      const props = getProps();
      if (!props?.id) {
        throw new Error("User not authenticated");
      }

      const storage = createUserStorage(env.USER_DATA_KV);
      const orders = await storage.orderHistory.getRecent(props.id, limit);

      const formatted = formatOrderHistoryCompact(orders);

      return {
        content: [
          {
            type: "text",
            text: `Order History (${orders.length} recent orders):\n\n${formatted}`,
          },
        ],
      };
    },
  );
}

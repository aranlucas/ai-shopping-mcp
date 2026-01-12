import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { formatOrderHistoryCompact } from "../utils/format-response.js";
import { createUserStorage, type OrderRecord } from "../utils/user-storage.js";

export interface MarkOrderPlacedInput {
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
    price?: number;
  }>;
  locationId?: string;
  notes?: string;
}

export interface ViewOrderHistoryInput {
  limit?: number;
}

export async function markOrderPlaced(
  input: MarkOrderPlacedInput,
  userId: string,
  kvNamespace: KVNamespace,
): Promise<CallToolResult> {
  const { items, locationId, notes } = input;

  if (!userId) {
    throw new Error("User not authenticated");
  }

  const storage = createUserStorage(kvNamespace);

  // Generate order ID with timestamp
  const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const totalItems = items.reduce(
    (sum: number, item: { quantity: number }) => sum + item.quantity,
    0,
  );
  const estimatedTotal = items.reduce(
    (sum: number, item: { price?: number; quantity: number }) => {
      return sum + (item.price || 0) * item.quantity;
    },
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

  await storage.orderHistory.add(userId, order);

  const formatted = formatOrderHistoryCompact([order]);

  return {
    content: [
      {
        type: "text",
        text: `Order recorded successfully:\n\n${formatted}`,
      },
    ],
  };
}

export async function viewOrderHistory(
  input: ViewOrderHistoryInput,
  userId: string,
  kvNamespace: KVNamespace,
): Promise<CallToolResult> {
  const { limit } = input;

  if (!userId) {
    throw new Error("User not authenticated");
  }

  const storage = createUserStorage(kvNamespace);
  const orders = await storage.orderHistory.getRecent(userId, limit || 10);

  const formatted = formatOrderHistoryCompact(orders);

  return {
    content: [
      {
        type: "text",
        text: `Order History (${orders.length} recent orders):\n\n${formatted}`,
      },
    ],
  };
}

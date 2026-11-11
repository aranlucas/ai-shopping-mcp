import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { OrderRecord } from "@/domain/shopping.js";
import type { OrderHistoryStore } from "@/utils/shopping-store.js";

import { appPayloadSchemas } from "@/app-results.js";
import { registerOrderTools, recordOrderInputSchema } from "@/tools/orders.js";
import { parseToolPayload } from "@test/app-payload.js";
import { strictFake } from "@test/strict-fake.js";
import { ensureShoppingSchema } from "@test/d1-schema.js";
import { createD1ShoppingStore } from "@/utils/d1-shopping-storage.js";
import {
  getCapturedHandler,
  getCapturedTool,
  makeContext,
  makeStorage,
  resetToolTestHarness,
} from "@test/tools/tool-test-harness.js";

function registerOrders(context: ReturnType<typeof makeContext>) {
  registerOrderTools(context.server, {
    orderHistory: context.orderHistory,
    preferredLocation: context.preferredLocation,
  });
}

describe("order storage-backed tools", () => {
  beforeAll(ensureShoppingSchema);

  beforeEach(() => {
    resetToolTestHarness();
  });

  it("records a retried orderId once and rejects reuse for different items", async () => {
    const shopper = createD1ShoppingStore(env.SHOPPING_DB, crypto.randomUUID());
    registerOrders(makeContext(makeStorage({ orderHistory: shopper.orderHistory })));
    const record = getCapturedHandler("record_order");
    const items = [{ productName: "Milk", quantity: 2 }];

    const first = await record({ orderId: "kroger-1234", items });
    const retry = await record({ orderId: "kroger-1234", items });
    const reused = await record({ orderId: "kroger-1234", items: [{ productName: "Eggs" }] });

    expect(first.text).toContain("Order recorded successfully: orderId=kroger-1234");
    expect(retry.isError).toBe(false);
    expect(retry.text).toContain("Order already recorded");
    expect(reused.isError).toBe(true);
    expect(reused.text).toContain("different items");
    expect(await shopper.orderHistory.getAll()).toMatchObject([{ orderId: "kroger-1234", items }]);
  });

  it("records order totals and optional metadata", async () => {
    const storedOrders: OrderRecord[] = [];

    const storage = makeStorage({
      orderHistory: strictFake<OrderHistoryStore>({
        add: async (order: OrderRecord) => {
          storedOrders.push(order);

          return { record: order, created: true };
        },
        getAll: async () => storedOrders,
      }),
    });

    const fixture = makeContext(storage);
    registerOrders(fixture);

    const result = await getCapturedHandler("record_order")({
      items: [
        {
          upc: "0000000000001",
          productName: "Apples",
          quantity: 2,
          price: 1.5,
        },
        { upc: "0000000000002", productName: "Bananas", quantity: 3 },
      ],
      storeId: "70500847",
      notes: "Pickup order",
    });

    expect(result.text).toContain("Order recorded successfully");
    expect(result.text).toContain("2 line item(s), 5 package(s)");
    expect(result.text).toContain("storeId=70500847");
    expect(result.text).toContain("Apples x2");
    expect(result.text).toContain("Bananas x3");
    expect(result.text).toContain("Estimated total: $3.00 (1/2 lines priced)");
    expect(result.text).toContain("Notes: Pickup order");
    expect(storedOrders).toHaveLength(1);
    expect(storedOrders[0]).toMatchObject({
      totalItems: 5,
      estimatedTotal: 3,
      locationId: "70500847",
      notes: "Pickup order",
    });
    expect(storedOrders[0]?.orderId).toMatch(/^ORD-/);
  });

  it("returns routed structured content with all order fields", async () => {
    const fixture = makeContext();
    registerOrders(fixture);

    const result = await getCapturedHandler("record_order")({
      items: [
        {
          upc: "0000000000001",
          productName: "Apples",
          quantity: 2,
          price: 1.5,
        },
      ],
      storeId: "70500847",
      notes: "Test note",
    });

    expect(result).toMatchObject({
      _meta: { "dev.aranlucas/view": "record_order" },
      structuredContent: {
        items: [
          {
            upc: "0000000000001",
            productName: "Apples",
            quantity: 2,
            price: 1.5,
          },
        ],
        totalItems: 2,
        estimatedTotal: 3,
        locationId: "70500847",
        notes: "Test note",
      },
    });

    const sc = parseToolPayload(appPayloadSchemas.record_order, result);

    expect(sc.orderId).toMatch(/^ORD-/);
    expect(sc.placedAt).toMatch(/^\d{4}-/);
  });

  it("sets estimatedTotal to undefined when no items carry a price", async () => {
    const fixture = makeContext();
    registerOrders(fixture);

    const result = await getCapturedHandler("record_order")({
      items: [
        { upc: "0000000000001", productName: "Apples", quantity: 2 },
        { upc: "0000000000002", productName: "Bananas", quantity: 3 },
      ],
    });

    expect(result.isError).toBe(false);

    const sc = parseToolPayload(appPayloadSchemas.record_order, result);

    expect(result).toMatchObject({
      _meta: { "dev.aranlucas/view": "record_order" },
    });
    expect(sc.totalItems).toBe(5);
    expect(sc.estimatedTotal).toBeUndefined();
  });

  it("accepts record_order items by name, with or without a upc", () => {
    const fixture = makeContext();
    registerOrders(fixture);

    const tool = getCapturedTool("record_order");

    const config = tool.config;

    expect(
      config.inputSchema.safeParse({
        items: [{ productName: "Apples", quantity: 2 }],
      }).success,
    ).toBe(true);
    expect(recordOrderInputSchema.safeParse({ items: [{ quantity: 2 }] }).success).toBe(false);
    expect(
      config.inputSchema.safeParse({
        items: [{ upc: "0000000000001", productName: "Apples", quantity: 2 }],
      }).success,
    ).toBe(true);
    expect(
      config.inputSchema.safeParse({
        items: [{ productId: "0000000000001", productName: "Apples", quantity: 2 }],
      }).success,
    ).toBe(false);
  });

  it("normalizes record_order upcs at the schema boundary", () => {
    const parsed = recordOrderInputSchema.parse({
      items: [{ upc: "1", productName: "Apples", quantity: 2 }],
    });

    expect(parsed.items).toEqual([{ upc: "0000000000001", productName: "Apples", quantity: 2 }]);
  });
});

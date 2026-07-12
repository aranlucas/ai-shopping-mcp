// oxlint-disable perfectionist/sort-imports
// tool-test-harness installs module mocks before the tool module is imported.
import { beforeEach, describe, expect, it } from "vitest";

import type { UserStorage } from "../../src/tools/types.js";
import type { OrderRecord } from "../../src/utils/user-storage.js";

import {
  getCapturedHandler,
  getCapturedTool,
  isErrorResult,
  makeContext,
  makeStorage,
  resetToolTestHarness,
  textFromResult,
} from "./tool-test-harness.js";
import { recordOrderInputSchema, registerOrderTools } from "../../src/tools/orders.js";

describe("order storage-backed tools", () => {
  beforeEach(() => {
    resetToolTestHarness();
  });

  it("records order totals and optional metadata", async () => {
    const storedOrders: OrderRecord[] = [];
    const storage = makeStorage({
      orderHistory: {
        add: async (_userId: string, order: OrderRecord) => {
          storedOrders.push(order);
        },
        getAll: async () => storedOrders,
      } as unknown as UserStorage["orderHistory"],
    });
    registerOrderTools(makeContext(storage));

    const result = await getCapturedHandler("record_order")({
      items: [
        { upc: "0000000000001", productName: "Apples", quantity: 2, price: 1.5 },
        { upc: "0000000000002", productName: "Bananas", quantity: 3 },
      ],
      storeId: "70500847",
      notes: "Pickup order",
    });

    expect(textFromResult(result)).toContain("Order recorded successfully");
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
    registerOrderTools(makeContext());

    const result = await getCapturedHandler("record_order")({
      items: [{ upc: "0000000000001", productName: "Apples", quantity: 2, price: 1.5 }],
      storeId: "70500847",
      notes: "Test note",
    });

    expect(result).toMatchObject({
      _meta: { "dev.aranlucas/view": "record_order" },
      structuredContent: {
        items: [{ upc: "0000000000001", productName: "Apples", quantity: 2, price: 1.5 }],
        totalItems: 2,
        estimatedTotal: 3,
        locationId: "70500847",
        notes: "Test note",
      },
    });
    const sc = (result as { structuredContent: { orderId: string; placedAt: string } })
      .structuredContent;
    expect(sc.orderId).toMatch(/^ORD-/);
    expect(sc.placedAt).toMatch(/^\d{4}-/);
  });

  it("sets estimatedTotal to undefined when no items carry a price", async () => {
    registerOrderTools(makeContext());

    const result = await getCapturedHandler("record_order")({
      items: [
        { upc: "0000000000001", productName: "Apples", quantity: 2 },
        { upc: "0000000000002", productName: "Bananas", quantity: 3 },
      ],
    });

    expect(isErrorResult(result)).toBe(false);
    const sc = (
      result as {
        structuredContent: { estimatedTotal?: number; totalItems: number };
      }
    ).structuredContent;
    expect(result).toMatchObject({ _meta: { "dev.aranlucas/view": "record_order" } });
    expect(sc.totalItems).toBe(5);
    expect(sc.estimatedTotal).toBeUndefined();
  });

  it("rejects record_order items without upc at the schema level", () => {
    registerOrderTools(makeContext());

    const tool = getCapturedTool("record_order");
    const config = tool.config as {
      inputSchema: { safeParse: (value: unknown) => { success: boolean } };
    };

    expect(
      config.inputSchema.safeParse({
        items: [{ productName: "Apples", quantity: 2 }],
      }).success,
    ).toBe(false);
    const directResult = recordOrderInputSchema.safeParse({
      items: [{ productName: "Apples", quantity: 2 }],
    });
    expect(directResult.success).toBe(false);
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

import { describe, expect, it } from "vitest";

import type { OrderRecord } from "../../src/domain/shopping.js";

import { computeRestockSuggestions } from "../../src/services/order-insights.js";

describe("order history insights", () => {
  describe("computeRestockSuggestions", () => {
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.parse("2026-07-02T00:00:00Z");

    function makeOrder(
      id: string,
      daysAgo: number,
      items: Array<{ productName: string; quantity?: number }>,
    ): OrderRecord {
      return {
        orderId: id,
        items: items.map((item) => ({
          productName: item.productName,
          quantity: item.quantity ?? 1,
        })),
        totalItems: items.length,
        placedAt: new Date(now - daysAgo * DAY).toISOString(),
      };
    }

    it("excludes items with fewer than 3 purchases", () => {
      const orders = [
        makeOrder("o1", 5, [{ productName: "Milk" }]),
        makeOrder("o2", 20, [{ productName: "Milk" }]),
      ];

      expect(computeRestockSuggestions(orders, now)).toEqual([]);
    });

    it("flags an item overdue relative to its median purchase interval (even interval count)", () => {
      // Purchased every 10 days, but the most recent purchase is 30 days
      // back — well past the median 10-day cadence.
      const orders = [
        makeOrder("o1", 50, [{ productName: "Milk" }]),
        makeOrder("o2", 40, [{ productName: "Milk" }]),
        makeOrder("o3", 30, [{ productName: "Milk" }]),
      ];

      expect(computeRestockSuggestions(orders, now)).toEqual([
        { name: "Milk", daysSinceLast: 30, medianIntervalDays: 10 },
      ]);
    });

    it("computes the median correctly for an odd number of intervals", () => {
      // 4 purchases -> 3 intervals: 20, 15, 20 days -> sorted [15, 20, 20] -> median 20.
      const orders = [
        makeOrder("o1", 80, [{ productName: "Eggs" }]),
        makeOrder("o2", 60, [{ productName: "Eggs" }]),
        makeOrder("o3", 45, [{ productName: "Eggs" }]),
        makeOrder("o4", 25, [{ productName: "Eggs" }]),
      ];

      expect(computeRestockSuggestions(orders, now)).toEqual([
        { name: "Eggs", daysSinceLast: 25, medianIntervalDays: 20 },
      ]);
    });

    it("excludes items that are not yet due", () => {
      // Purchased every ~10 days, and the last purchase was only 9 days ago.
      const orders = [
        makeOrder("o1", 29, [{ productName: "Bread" }]),
        makeOrder("o2", 19, [{ productName: "Bread" }]),
        makeOrder("o3", 9, [{ productName: "Bread" }]),
      ];

      expect(computeRestockSuggestions(orders, now)).toEqual([]);
    });

    it("groups purchases by case-insensitive product name", () => {
      const orders = [
        makeOrder("o1", 50, [{ productName: "milk" }]),
        makeOrder("o2", 40, [{ productName: "Milk" }]),
        makeOrder("o3", 30, [{ productName: "MILK" }]),
      ];

      const suggestions = computeRestockSuggestions(orders, now);
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]).toMatchObject({
        daysSinceLast: 30,
        medianIntervalDays: 10,
      });
      expect(suggestions[0].name.toLowerCase()).toBe("milk");
    });

    it("caps suggestions at 5, sorted most-overdue first", () => {
      // Each product: bought every 10 days; "last" varies so overdue amount
      // (daysSinceLast - medianIntervalDays) is 5, 10, 15, 20, 25, 30.
      const lastDays = [15, 20, 25, 30, 35, 40];

      const orders = lastDays.flatMap((last, i) => {
        const name = `Product${i + 1}`;

        return [
          makeOrder(`${name}-o1`, last + 20, [{ productName: name }]),
          makeOrder(`${name}-o2`, last + 10, [{ productName: name }]),
          makeOrder(`${name}-o3`, last, [{ productName: name }]),
        ];
      });

      const suggestions = computeRestockSuggestions(orders, now);

      expect(suggestions).toHaveLength(5);
      expect(suggestions.map((s) => s.name)).toEqual([
        "Product6",
        "Product5",
        "Product4",
        "Product3",
        "Product2",
      ]);
    });

    it("ignores orders with an unparseable placedAt date", () => {
      const badOrder: OrderRecord = {
        orderId: "bad",
        items: [{ productName: "Milk", quantity: 1 }],
        totalItems: 1,
        placedAt: "not-a-date",
      };

      const orders = [
        badOrder,
        makeOrder("o1", 50, [{ productName: "Milk" }]),
        makeOrder("o2", 40, [{ productName: "Milk" }]),
        makeOrder("o3", 30, [{ productName: "Milk" }]),
      ];

      expect(computeRestockSuggestions(orders, now)).toEqual([
        { name: "Milk", daysSinceLast: 30, medianIntervalDays: 10 },
      ]);
    });
  });
});

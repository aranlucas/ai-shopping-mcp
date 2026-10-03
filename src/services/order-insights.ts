import type { OrderRecord } from "../domain/shopping.js";

/**
 * Ranks item names by purchase frequency across recent orders. Used by
 * `get_shopping_profile`.
 */
export function computeFrequentlyPurchasedItems(
  recentOrders: OrderRecord[],
  limit = 10,
): Array<{ name: string; count: number }> {
  const itemFrequency = new Map<string, number>();

  for (const order of recentOrders) {
    for (const item of order.items) {
      const name = item.productName.toLowerCase();
      itemFrequency.set(name, (itemFrequency.get(name) ?? 0) + 1);
    }
  }

  return [...itemFrequency.entries()]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

export type RestockSuggestion = {
  name: string;
  daysSinceLast: number;
  medianIntervalDays: number;
};

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function median(values: number[]): number {
  const sorted = [...values].toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Replenishment: for each product name (case-insensitive) with at least 3
 * purchases in order history, computes the median interval between
 * consecutive purchases and flags items overdue relative to that interval —
 * i.e. `now - lastPurchase > medianInterval`. Sorted most-overdue first,
 * capped at 5.
 */
export function computeRestockSuggestions(
  orders: OrderRecord[],
  now: number = Date.now(),
): RestockSuggestion[] {
  const purchasesByName = new Map<
    string,
    { displayName: string; timestamps: number[] }
  >();

  for (const order of orders) {
    const placedAt = new Date(order.placedAt).getTime();

    if (Number.isNaN(placedAt)) continue;

    for (const item of order.items) {
      const key = item.productName.toLowerCase();
      const existing = purchasesByName.get(key);

      if (existing) {
        existing.timestamps.push(placedAt);
      } else {
        purchasesByName.set(key, {
          displayName: item.productName,
          timestamps: [placedAt],
        });
      }
    }
  }

  const suggestions: RestockSuggestion[] = [];

  for (const { displayName, timestamps } of purchasesByName.values()) {
    if (timestamps.length < 3) continue;

    const sorted = [...timestamps].toSorted((a, b) => a - b);
    const intervals: number[] = [];

    for (let i = 1; i < sorted.length; i++) {
      intervals.push(sorted[i] - sorted[i - 1]);
    }

    const medianIntervalMs = median(intervals);
    const lastPurchase = sorted[sorted.length - 1];
    const sinceLastMs = now - lastPurchase;

    if (sinceLastMs > medianIntervalMs) {
      suggestions.push({
        name: displayName,
        daysSinceLast: Math.floor(sinceLastMs / MS_PER_DAY),
        medianIntervalDays: Math.round(medianIntervalMs / MS_PER_DAY),
      });
    }
  }

  // Most-overdue first: rank by how many days past the median interval the
  // item is, not raw days-since-last (a rarely-bought item with a long
  // interval shouldn't outrank a frequently-bought item that's well overdue).
  return suggestions
    .toSorted((a, b) => {
      const overdueA = a.daysSinceLast - a.medianIntervalDays;
      const overdueB = b.daysSinceLast - b.medianIntervalDays;

      return overdueB - overdueA;
    })
    .slice(0, 5);
}

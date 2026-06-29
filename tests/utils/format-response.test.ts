import { describe, expect, it } from "vitest";

import type {
  EquipmentItem,
  OrderRecord,
  PantryItem,
  PreferredLocation,
  ShoppingListItem,
} from "../../src/utils/user-storage.js";

import {
  formatEquipmentItemCompact,
  formatEquipmentListCompact,
  formatOrderHistoryCompact,
  formatOrderRecordCompact,
  formatPantryItemCompact,
  formatPantryListCompact,
  formatPreferredLocationCompact,
  formatShoppingListCompact,
  formatShoppingListItemCompact,
} from "../../src/utils/format-response.js";

// ----- Pantry Item Compact -----

describe("formatPantryItemCompact", () => {
  it("formats item with no expiry as 'Name xQty'", () => {
    const item: PantryItem = {
      productName: "Milk",
      quantity: 1,
      addedAt: "2025-01-15T00:00:00Z",
    };
    expect(formatPantryItemCompact(item)).toBe("Milk x1");
  });

  it("shows expired indicator for past expiry dates", () => {
    const item: PantryItem = {
      productName: "Eggs",
      quantity: 12,
      addedAt: "2025-01-01T00:00:00Z",
      expiresAt: "2020-01-01T00:00:00Z",
    };
    const result = formatPantryItemCompact(item);
    expect(result).toContain("❌EXPIRED");
  });

  it("shows TODAY indicator when item expires today (daysUntil === 0)", () => {
    // 12 hours from now → Math.floor(0.5 days) = 0
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    const item: PantryItem = {
      productName: "Yogurt",
      quantity: 2,
      addedAt: new Date().toISOString(),
      expiresAt,
    };
    const result = formatPantryItemCompact(item);
    expect(result).toContain("⚠️TODAY");
  });

  it("shows day count warning when item expires within 1-3 days", () => {
    // 2.5 days from now → Math.floor(2.5) = 2
    const expiresAt = new Date(Date.now() + 2.5 * 24 * 60 * 60 * 1000).toISOString();
    const item: PantryItem = {
      productName: "Cheese",
      quantity: 1,
      addedAt: new Date().toISOString(),
      expiresAt,
    };
    const result = formatPantryItemCompact(item);
    expect(result).toContain("⚠️2d");
  });

  it("shows plain locale date string when item expires more than 3 days away", () => {
    const futureMs = Date.now() + 5 * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(futureMs).toISOString();
    const expectedDate = new Date(futureMs).toLocaleDateString();
    const item: PantryItem = {
      productName: "Flour",
      quantity: 2,
      addedAt: new Date().toISOString(),
      expiresAt,
    };
    const result = formatPantryItemCompact(item);
    expect(result).toBe(`Flour x2 | ${expectedDate}`);
  });
});

// ----- Pantry List Compact -----

describe("formatPantryListCompact", () => {
  it("returns empty message for empty pantry", () => {
    expect(formatPantryListCompact([])).toBe("Pantry empty.");
  });

  it("formats non-empty list as numbered items", () => {
    const items: PantryItem[] = [
      { productName: "Milk", quantity: 1, addedAt: "2025-01-15T00:00:00Z" },
      { productName: "Eggs", quantity: 12, addedAt: "2025-01-15T00:00:00Z" },
    ];
    const result = formatPantryListCompact(items);
    expect(result).toContain("1. Milk x1");
    expect(result).toContain("2. Eggs x12");
  });
});

// ----- Order Record Compact -----

describe("formatOrderRecordCompact", () => {
  it("formats order with shortened ID, date, item count, total, and location", () => {
    const order: OrderRecord = {
      orderId: "abc-123-def",
      items: [],
      totalItems: 5,
      estimatedTotal: 25.0,
      placedAt: "2025-01-20T14:00:00Z",
      locationId: "70500847",
    };
    const result = formatOrderRecordCompact(order);
    expect(result).toContain("#def");
    expect(result).toContain("5 items");
    expect(result).toContain("$25.00");
    expect(result).toContain("70500847");
  });

  it("omits dollar amount from summary when estimatedTotal is absent", () => {
    const order: OrderRecord = {
      orderId: "abc-123-def",
      items: [],
      totalItems: 3,
      placedAt: "2025-01-20T14:00:00Z",
      locationId: "70500847",
    };
    const result = formatOrderRecordCompact(order);
    expect(result).toContain("3 items");
    expect(result).not.toContain("$");
    expect(result).toContain("70500847");
  });

  it("omits location segment when locationId is absent", () => {
    const order: OrderRecord = {
      orderId: "abc-123-def",
      items: [],
      totalItems: 2,
      estimatedTotal: 10.0,
      placedAt: "2025-01-20T14:00:00Z",
    };
    const result = formatOrderRecordCompact(order);
    expect(result).toContain("#def");
    expect(result).toContain("2 items $10.00");
    // Without locationId there are only 3 pipe-separated segments
    const parts = result.split(" | ");
    expect(parts).toHaveLength(3);
  });
});

// ----- Order History Compact -----

describe("formatOrderHistoryCompact", () => {
  it("returns empty message for no orders", () => {
    expect(formatOrderHistoryCompact([])).toBe("No orders.");
  });

  it("formats non-empty order list as numbered items", () => {
    const orders: OrderRecord[] = [
      {
        orderId: "abc-123-def",
        items: [],
        totalItems: 5,
        estimatedTotal: 25.0,
        placedAt: "2025-01-20T14:00:00Z",
        locationId: "70500847",
      },
    ];
    const result = formatOrderHistoryCompact(orders);
    expect(result).toMatch(/^1\. /);
    expect(result).toContain("#def");
    expect(result).toContain("5 items $25.00");
    expect(result).toContain("70500847");
  });
});

// ----- Equipment Item Compact -----

describe("formatEquipmentItemCompact", () => {
  it("formats equipment with category as 'Name | Category'", () => {
    const item: EquipmentItem = {
      equipmentName: "Oven",
      category: "Cooking",
      addedAt: "2025-01-01T00:00:00Z",
    };
    expect(formatEquipmentItemCompact(item)).toBe("Oven | Cooking");
  });

  it("formats equipment without category as just the name", () => {
    const item: EquipmentItem = {
      equipmentName: "Knife",
      addedAt: "2025-01-01T00:00:00Z",
    };
    expect(formatEquipmentItemCompact(item)).toBe("Knife");
  });
});

// ----- Equipment List Compact -----

describe("formatEquipmentListCompact", () => {
  it("returns empty message for no equipment", () => {
    expect(formatEquipmentListCompact([])).toBe("Equipment list empty.");
  });

  it("formats non-empty equipment list as numbered items", () => {
    const items: EquipmentItem[] = [
      { equipmentName: "Oven", category: "Cooking", addedAt: "2025-01-01T00:00:00Z" },
      { equipmentName: "Knife", addedAt: "2025-01-01T00:00:00Z" },
    ];
    const result = formatEquipmentListCompact(items);
    expect(result).toContain("1. Oven | Cooking");
    expect(result).toContain("2. Knife");
  });
});

// ----- Preferred Location Compact -----

describe("formatPreferredLocationCompact", () => {
  it("formats as 'Name (Chain) | Address | LocationId'", () => {
    const location: PreferredLocation = {
      locationId: "70500847",
      locationName: "QFC #815",
      address: "100 Main St",
      chain: "QFC",
      setAt: "2025-01-01T00:00:00Z",
    };
    expect(formatPreferredLocationCompact(location)).toBe(
      "QFC #815 (QFC) | 100 Main St | 70500847",
    );
  });
});

// ----- Shopping List Item Compact -----

describe("formatShoppingListItemCompact", () => {
  it("formats unchecked item as '[ ] Name xQty'", () => {
    const item: ShoppingListItem = {
      productName: "Butter",
      quantity: 1,
      addedAt: "2025-01-01T00:00:00Z",
      checked: false,
    };
    expect(formatShoppingListItemCompact(item)).toBe("[ ] Butter x1");
  });

  it("formats checked item with UPC and notes including all fields", () => {
    const item: ShoppingListItem = {
      productName: "Eggs",
      quantity: 12,
      upc: "0001111042010",
      notes: "large",
      addedAt: "2025-01-01T00:00:00Z",
      checked: true,
    };
    expect(formatShoppingListItemCompact(item)).toBe("[x] Eggs x12 | 0001111042010 | large");
  });
});

// ----- Shopping List Compact -----

describe("formatShoppingListCompact", () => {
  it("returns empty message for empty list", () => {
    expect(formatShoppingListCompact([])).toBe("Shopping list empty.");
  });

  it("formats non-empty list as numbered items for both checked and unchecked", () => {
    const items: ShoppingListItem[] = [
      { productName: "Bread", quantity: 1, addedAt: "2025-01-15T00:00:00Z", checked: false },
      { productName: "Milk", quantity: 2, addedAt: "2025-01-15T00:00:00Z", checked: true },
    ];
    const result = formatShoppingListCompact(items);
    expect(result).toContain("1. [ ] Bread x1");
    expect(result).toContain("2. [x] Milk x2");
  });
});

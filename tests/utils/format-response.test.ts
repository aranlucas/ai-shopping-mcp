import { describe, expect, it } from "vitest";

import type { CatalogProduct, CatalogProvider } from "../../src/services/catalog/types.js";

import type { components as LocationComponents } from "../../src/services/kroger/location.js";
import type { components as ProductComponents } from "../../src/services/kroger/product.js";
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
  formatProductDetailMarkdown,
  formatCatalogProductLine,
  formatCatalogSearchMarkdown,
  formatShoppingListCompact,
  formatShoppingListItemCompact,
  formatStoreDetailMarkdown,
  formatStoreLineMarkdown,
  formatStoreListMarkdown,
  formatWeeklyDealsMarkdown,
} from "../../src/utils/format-response.js";

// Note: formatProduct*, formatLocation*, formatWeeklyDeal(s)/(Compact) (list
// variants), formatPantryItem/formatPantryList, formatOrderRecord/
// formatOrderHistory, formatEquipmentItem/formatEquipmentList,
// formatShoppingList/formatShoppingListItem, and formatPreferredLocation were
// removed as dead code (zero call sites in src/) — see
// docs/small-model-efficiency-plan.md, "Code health".

type Product = ProductComponents["schemas"]["products.productModel"];
type Location = LocationComponents["schemas"]["locations.location"];

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    upc: "0001111041700",
    description: "Kroger 2% Reduced Fat Milk",
    brand: "Kroger",
    aisleLocations: [{ description: "Dairy", number: "21" }],
    items: [
      {
        size: "1 gal",
        price: { regular: 3.49, promo: 2.99 },
        fulfillment: { curbside: true, instore: true, delivery: false, shiptohome: false },
      },
    ],
    ...overrides,
  };
}

function makeLocation(overrides: Partial<Location> = {}): Location {
  return {
    locationId: "70500034",
    name: "QFC Broadway",
    chain: "QFC",
    address: {
      addressLine1: "417 Broadway E",
      city: "Seattle",
      state: "WA",
      zipCode: "98102",
    },
    phone: "206-555-1234",
    ...overrides,
  };
}

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
      provider: "kroger",
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
  it("formats item without UPC or notes as 'Name xQty'", () => {
    const item: ShoppingListItem = {
      productName: "Butter",
      quantity: 1,
    };
    expect(formatShoppingListItemCompact(item)).toBe("Butter x1");
  });

  it("formats a legacy UPC as a namespaced Kroger product reference", () => {
    const item: ShoppingListItem = {
      productName: "Eggs",
      quantity: 12,
      upc: "0001111042010",
      notes: "large",
    };
    expect(formatShoppingListItemCompact(item)).toBe(
      "Eggs x12 | productRef=kroger:0001111042010 | large",
    );
  });
});

// ----- Shopping List Compact -----

describe("formatShoppingListCompact", () => {
  it("returns empty message for empty list", () => {
    expect(formatShoppingListCompact([])).toBe("Shopping list empty.");
  });

  it("formats non-empty list as numbered items", () => {
    const items: ShoppingListItem[] = [
      { productName: "Bread", quantity: 1 },
      { productName: "Milk", quantity: 2 },
    ];
    const result = formatShoppingListCompact(items);
    expect(result).toContain("1. Bread x1");
    expect(result).toContain("2. Milk x2");
  });
});

// ----- Markdown formatters (model-facing content) -----

const krogerProvider: CatalogProvider = {
  id: "kroger",
  label: "Kroger",
  capabilities: { cart: true, aisleLocation: true },
  search: () => {
    throw new Error("not used by formatter tests");
  },
  get: () => {
    throw new Error("not used by formatter tests");
  },
};

const traderJoesProvider: CatalogProvider = {
  id: "trader_joes",
  label: "Trader Joe's",
  capabilities: { cart: false, aisleLocation: false },
  search: () => {
    throw new Error("not used by formatter tests");
  },
  get: () => {
    throw new Error("not used by formatter tests");
  },
};

function krogerProduct(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    ref: { provider: "kroger", id: "0001111041700" },
    name: "Kroger 2% Reduced Fat Milk",
    brand: "Kroger",
    size: "1 gal",
    price: 2.99,
    regularPrice: 3.49,
    available: true,
    pickup: true,
    ...overrides,
  };
}

describe("formatCatalogProductLine", () => {
  it("labels the identifier with its provider and omits location by default", () => {
    const line = formatCatalogProductLine(krogerProduct(), krogerProvider);
    expect(line).toBe(
      "- productRef=kroger:0001111041700 | Kroger 2% Reduced Fat Milk | Kroger | 1 gal | $2.99 (was $3.49) | pickup: yes",
    );
  });

  it("calls a cartless provider's identifier a sku, and omits pickup", () => {
    const line = formatCatalogProductLine(
      {
        ref: { provider: "trader_joes", id: "076892" },
        name: "Chili Onion Crunch",
        price: 3.99,
        size: "6 Ounce",
        available: true,
      },
      traderJoesProvider,
    );
    expect(line).toContain("productRef=trader_joes:076892");
    expect(line).not.toContain("pickup:");
  });

  it("includes aisle and shelf details when location output is requested", () => {
    const line = formatCatalogProductLine(
      krogerProduct({
        aisle: {
          description: "AISLE 3",
          number: "3",
          sequenceNumber: "7",
          bayNumber: "35",
          side: "L",
          shelfNumber: "4",
          shelfPositionInBay: "2",
        },
      }),
      krogerProvider,
      { includeLocation: true },
    );

    expect(line).toContain("location: AISLE 3");
    expect(line).not.toContain("location: AISLE 3 3");
    expect(line).toContain("route sequence: 7");
    expect(line).toContain("bay: 35");
    expect(line).toContain("side: L");
    expect(line).toContain("shelf: 4");
    expect(line).toContain("shelf position: 2");
  });

  it("omits the 'was' price when there is no promo", () => {
    const line = formatCatalogProductLine(
      krogerProduct({ price: 3.49, regularPrice: undefined }),
      krogerProvider,
    );
    expect(line).toContain("$3.49");
    expect(line).not.toContain("was");
  });

  it("shows pickup: no when the provider offers no pickup for the item", () => {
    const line = formatCatalogProductLine(krogerProduct({ pickup: false }), krogerProvider);
    expect(line).toContain("pickup: no");
  });

  it("marks an unavailable item", () => {
    const line = formatCatalogProductLine(krogerProduct({ available: false }), krogerProvider);
    expect(line).toContain("out of stock");
  });
});

describe("formatCatalogSearchMarkdown", () => {
  it("renders a heading and product lines per search term", () => {
    const text = formatCatalogSearchMarkdown(
      [{ provider: "kroger", term: "milk", products: [krogerProduct()], failed: false }],
      [krogerProvider],
    );
    expect(text).toContain("## milk");
    expect(text).toContain("productRef=kroger:0001111041700");
    expect(text).not.toContain("location:");
  });

  it("groups both providers under one term heading", () => {
    const text = formatCatalogSearchMarkdown(
      [
        { provider: "kroger", term: "crunch", products: [krogerProduct()], failed: false },
        {
          provider: "trader_joes",
          term: "crunch",
          products: [
            {
              ref: { provider: "trader_joes", id: "076892" },
              name: "Chili Onion Crunch",
              available: true,
            },
          ],
          failed: false,
        },
      ],
      [krogerProvider, traderJoesProvider],
    );
    expect(text.match(/## crunch/gu)).toHaveLength(1);
    expect(text).toContain("productRef=kroger:");
    expect(text).toContain("productRef=trader_joes:076892");
  });

  it("passes the location opt-in through to product lines", () => {
    const text = formatCatalogSearchMarkdown(
      [
        {
          provider: "kroger",
          term: "milk",
          products: [krogerProduct({ aisle: { description: "Dairy", number: "21" } })],
          failed: false,
        },
      ],
      [krogerProvider],
      { includeLocation: true },
    );
    expect(text).toContain("location: Dairy 21");
  });

  it("names the provider when a term has no results", () => {
    const text = formatCatalogSearchMarkdown(
      [{ provider: "kroger", term: "unobtainium", products: [], failed: false }],
      [krogerProvider],
    );
    expect(text).toContain("## unobtainium");
    expect(text).toContain("No Kroger results.");
  });

  it("names the provider when a term failed", () => {
    const text = formatCatalogSearchMarkdown(
      [{ provider: "kroger", term: "eggs", products: [], failed: true }],
      [krogerProvider],
    );
    expect(text).toContain("Kroger search failed for this term.");
  });

  it("reminds the model to preserve universal product references", () => {
    const withCart = formatCatalogSearchMarkdown(
      [{ provider: "kroger", term: "milk", products: [krogerProduct()], failed: false }],
      [krogerProvider],
    );
    expect(withCart).toContain("pass the productRef values above to create_shopping_list");

    const withoutCart = formatCatalogSearchMarkdown(
      [{ provider: "trader_joes", term: "milk", products: [], failed: false }],
      [traderJoesProvider],
    );
    expect(withoutCart).not.toContain("pass the productRef values above to create_shopping_list");
    expect(withoutCart).toContain("Trader Joe's has no cart");
  });
});

describe("formatProductDetailMarkdown", () => {
  it("includes upc, description, brand, variant lines, and aisle", () => {
    const text = formatProductDetailMarkdown(makeProduct());
    expect(text).toContain("upc: 0001111041700");
    expect(text).toContain("description: Kroger 2% Reduced Fat Milk");
    expect(text).toContain("brand: Kroger");
    expect(text).toContain("1 gal");
    expect(text).toContain("$2.99 (was $3.49)");
    expect(text).toContain("pickup: yes");
    expect(text).toContain("aisle: Dairy 21");
  });

  it("does not mention images", () => {
    const text = formatProductDetailMarkdown(
      makeProduct({
        images: [{ perspective: "front", default: true, sizes: [{ id: "a", url: "http://x" }] }],
      }),
    );
    expect(text).not.toContain("images");
    expect(text).not.toContain("http://x");
  });
});

describe("formatStoreLineMarkdown / formatStoreListMarkdown", () => {
  it("formats storeId, name, address, and phone", () => {
    const line = formatStoreLineMarkdown(makeLocation());
    expect(line).toBe(
      "- storeId=70500034 | QFC Broadway | 417 Broadway E, Seattle WA 98102 | phone 206-555-1234",
    );
  });

  it("returns 'No stores found.' for an empty list", () => {
    expect(formatStoreListMarkdown([])).toBe("No stores found.");
  });

  it("formats one line per store", () => {
    const text = formatStoreListMarkdown([
      makeLocation(),
      makeLocation({ locationId: "70500099" }),
    ]);
    expect(text).toContain("storeId=70500034");
    expect(text).toContain("storeId=70500099");
  });
});

describe("formatStoreDetailMarkdown", () => {
  it("includes the store line plus hours when hours are present", () => {
    const text = formatStoreDetailMarkdown(
      makeLocation({
        hours: {
          timezone: "America/Los_Angeles",
          monday: { open: "07:00", close: "22:00" },
        },
      }),
    );
    expect(text).toContain("storeId=70500034");
    expect(text).toContain("hours:");
    expect(text).toContain("monday: 07:00-22:00");
  });

  it("omits the hours block when no hours are present", () => {
    const text = formatStoreDetailMarkdown(makeLocation());
    expect(text).not.toContain("hours:");
  });
});

describe("formatWeeklyDealsMarkdown", () => {
  it("includes a validity header and dealCount when both dates are present", () => {
    const text = formatWeeklyDealsMarkdown(
      [
        {
          title: "Ground Beef",
          details: "80% Lean",
          price: "$3.99/lb",
          savings: "Save $2.00",
          category: "Meat & Seafood",
        },
      ],
      "2026-06-25",
      "2026-07-01",
    );
    expect(text).toContain("Deals valid 2026-06-25 to 2026-07-01. dealCount: 1");
    expect(text).toContain("- Ground Beef | 80% Lean | $3.99/lb | Save $2.00");
  });

  it("falls back to a bare dealCount header when dates are missing", () => {
    const text = formatWeeklyDealsMarkdown([{ title: "Bananas", category: "Produce" }]);
    expect(text).toContain("dealCount: 1");
    expect(text).not.toContain("Deals valid");
  });

  it("includes warnings when present", () => {
    const text = formatWeeklyDealsMarkdown([], undefined, undefined, ["Live refresh failed"]);
    expect(text).toContain("warnings: Live refresh failed");
  });

  it("handles an empty deals array", () => {
    const text = formatWeeklyDealsMarkdown([]);
    expect(text).toBe("dealCount: 0");
  });

  it("groups consecutive deals under a category label, without repeating it", () => {
    const text = formatWeeklyDealsMarkdown([
      { title: "Flank Steaks", price: "$6.99/lb", category: "Meat & Seafood" },
      { title: "Ground Beef", price: "$4.99/lb", category: "Meat & Seafood" },
      { title: "Zucchini", price: "$1.99", category: "Produce" },
    ]);
    const lines = text.split("\n");
    expect(lines).toEqual([
      "dealCount: 3",
      "Meat & Seafood:",
      "- Flank Steaks | $6.99/lb",
      "- Ground Beef | $4.99/lb",
      "Produce:",
      "- Zucchini | $1.99",
    ]);
  });

  it("does not use markdown heading syntax for category labels", () => {
    const text = formatWeeklyDealsMarkdown([
      { title: "Flank Steaks", price: "$6.99/lb", category: "Meat & Seafood" },
    ]);
    expect(text).not.toContain("#");
  });
});

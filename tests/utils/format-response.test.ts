import {
  formatEquipmentItem,
  formatEquipmentItemCompact,
  formatEquipmentList,
  formatEquipmentListCompact,
  formatLocation,
  formatLocationCompact,
  formatLocationList,
  formatLocationListCompact,
  formatOrderHistory,
  formatOrderHistoryCompact,
  formatOrderRecord,
  formatOrderRecordCompact,
  formatPantryItem,
  formatPantryItemCompact,
  formatPantryList,
  formatPantryListCompact,
  formatPreferredLocation,
  formatPreferredLocationCompact,
  formatProduct,
  formatProductCompact,
  formatProductList,
  formatProductListCompact,
  formatProductListWithOptions,
  formatProductWithOptions,
  formatShoppingList,
  formatShoppingListCompact,
  formatShoppingListItem,
  formatShoppingListItemCompact,
  formatWeeklyDeal,
  formatWeeklyDealsList,
} from "../../src/utils/format-response";

// ----- Product Formatting -----

describe("formatProduct", () => {
  it("formats a basic product with name and brand", () => {
    const product = {
      description: "Whole Milk",
      brand: "Kroger",
      upc: "0001111042010",
    };
    const result = formatProduct(product);
    expect(result).toContain("**Whole Milk**");
    expect(result).toContain("Brand: Kroger");
    expect(result).toContain("UPC: 0001111042010");
  });

  it("formats a product with pricing", () => {
    const product = {
      description: "Organic Eggs",
      items: [{ price: { regular: 4.99, promo: 0 } }],
    };
    const result = formatProduct(product);
    expect(result).toContain("Price: $4.99");
  });

  it("shows sale price when promo differs from regular", () => {
    const product = {
      description: "Cereal",
      items: [{ price: { regular: 5.99, promo: 3.99 } }],
    };
    const result = formatProduct(product);
    expect(result).toContain("~~$5.99~~");
    expect(result).toContain("**$3.99**");
    expect(result).toContain("Sale!");
  });

  it("formats fulfillment availability", () => {
    const product = {
      description: "Bread",
      items: [
        {
          fulfillment: {
            curbside: true,
            delivery: true,
            instore: true,
            shiptohome: false,
          },
        },
      ],
    };
    const result = formatProduct(product);
    expect(result).toContain("Curbside");
    expect(result).toContain("Delivery");
    expect(result).toContain("In-Store");
    expect(result).not.toContain("Ship to Home");
  });

  it("formats size information", () => {
    const product = {
      description: "Milk",
      items: [{ size: "1 gal" }],
    };
    const result = formatProduct(product);
    expect(result).toContain("Size: 1 gal");
  });

  it("formats categories and aisle locations", () => {
    const product = {
      description: "Chips",
      categories: ["Snacks", "Chips"],
      aisleLocations: [{ description: "Snack Aisle", number: "7" }],
    };
    const result = formatProduct(product);
    expect(result).toContain("Category: Snacks > Chips");
    expect(result).toContain("Aisle: Snack Aisle (7)");
  });

  it("handles a minimal product with only description", () => {
    const product = { description: "Simple Item" };
    const result = formatProduct(product);
    expect(result).toBe("**Simple Item**");
  });
});

describe("formatProductList", () => {
  it("returns empty message for no products", () => {
    expect(formatProductList([])).toBe("No products found.");
  });

  it("formats numbered list of products", () => {
    const products = [{ description: "Item A" }, { description: "Item B" }];
    const result = formatProductList(products);
    expect(result).toContain("1. **Item A**");
    expect(result).toContain("2. **Item B**");
  });
});

describe("formatProductCompact", () => {
  it("formats product in compact pipe-separated format", () => {
    const product = {
      description: "Whole Milk",
      brand: "Kroger",
      upc: "0001111042010",
      items: [
        {
          size: "1 gal",
          price: { regular: 3.49, promo: 0 },
          fulfillment: { curbside: true, delivery: false, instore: true },
        },
      ],
      aisleLocations: [{ description: "Dairy", number: "1" }],
    };
    const result = formatProductCompact(product);
    expect(result).toContain("Whole Milk (Kroger)");
    expect(result).toContain("1 gal");
    expect(result).toContain("$3.49");
    expect(result).toContain("[P/S]");
    expect(result).toContain("0001111042010");
    expect(result).toContain("Dairy");
  });

  it("shows [OOS] when no fulfillment options available", () => {
    const product = {
      description: "Rare Item",
      items: [
        {
          fulfillment: {
            curbside: false,
            delivery: false,
            instore: false,
          },
        },
      ],
    };
    const result = formatProductCompact(product);
    expect(result).toContain("[OOS]");
  });

  it("falls back to Unknown when no description", () => {
    const product = {} as Parameters<typeof formatProductCompact>[0];
    const result = formatProductCompact(product);
    expect(result).toContain("Unknown");
  });
});

describe("formatProductListCompact", () => {
  it("returns empty message for no products", () => {
    expect(formatProductListCompact([])).toBe("No products found.");
  });
});

describe("formatProductWithOptions", () => {
  it("shows stock warnings", () => {
    const product = {
      description: "Limited Item",
      items: [
        {
          size: "12 oz",
          price: { regular: 2.99 },
          fulfillment: { curbside: true },
          inventory: { stockLevel: "LOW" as const },
        },
      ],
    };
    const result = formatProductWithOptions(product);
    expect(result).toContain("Low Stock");
  });

  it("shows out of stock indicator", () => {
    const product = {
      description: "Gone Item",
      items: [
        {
          fulfillment: {},
          inventory: { stockLevel: "TEMPORARILY_OUT_OF_STOCK" as const },
        },
      ],
    };
    const result = formatProductWithOptions(product);
    expect(result).toContain("Out");
  });
});

describe("formatProductListWithOptions", () => {
  it("returns empty message for no products", () => {
    expect(formatProductListWithOptions([])).toBe("No products found.");
  });
});

// ----- Location Formatting -----

describe("formatLocation", () => {
  it("formats a location with full details", () => {
    const location = {
      name: "QFC #815",
      chain: "QFC",
      locationId: "70500847",
      address: {
        addressLine1: "100 Main St",
        city: "Seattle",
        state: "WA",
        zipCode: "98101",
      },
      phone: "206-555-1234",
    };
    const result = formatLocation(location);
    expect(result).toContain("**QFC #815**");
    expect(result).toContain("Chain: QFC");
    expect(result).toContain("Address: 100 Main St");
    expect(result).toContain("Seattle, WA 98101");
    expect(result).toContain("Phone: 206-555-1234");
    expect(result).toContain("Location ID: 70500847");
  });

  it("formats hours and timezone", () => {
    const location = {
      name: "Store",
      hours: { timezone: "America/Los_Angeles" },
    };
    const result = formatLocation(location);
    expect(result).toContain("**Hours:**");
    expect(result).toContain("Timezone: America/Los_Angeles");
  });

  it("formats departments", () => {
    const location = {
      name: "Store",
      departments: [{ name: "Bakery", phone: "555-0001" }, { name: "Deli" }],
    };
    const result = formatLocation(location);
    expect(result).toContain("**Departments:**");
    expect(result).toContain("- Bakery (555-0001)");
    expect(result).toContain("- Deli");
  });
});

describe("formatLocationList", () => {
  it("returns empty message for no locations", () => {
    expect(formatLocationList([])).toBe("No locations found.");
  });
});

describe("formatLocationCompact", () => {
  it("formats location in compact pipe-separated format", () => {
    const location = {
      name: "QFC",
      chain: "QFC",
      locationId: "70500847",
      address: {
        addressLine1: "100 Main St",
        city: "Seattle",
        state: "WA",
        zipCode: "98101",
      },
      phone: "206-555-1234",
    };
    const result = formatLocationCompact(location);
    expect(result).toContain("QFC (QFC)");
    expect(result).toContain("100 Main St");
    expect(result).toContain("ID:70500847");
    expect(result).toContain("206-555-1234");
  });

  it("falls back to Unknown for missing name", () => {
    const location = {} as Parameters<typeof formatLocationCompact>[0];
    const result = formatLocationCompact(location);
    expect(result).toContain("Unknown");
  });
});

describe("formatLocationListCompact", () => {
  it("returns empty message for no locations", () => {
    expect(formatLocationListCompact([])).toBe("No locations found.");
  });
});

// ----- Weekly Deals -----

describe("formatWeeklyDeal", () => {
  it("formats a full deal", () => {
    const deal = {
      product: "Ground Beef",
      details: "80% Lean",
      price: "$3.99/lb",
      savings: "Save $2.00",
      loyalty: "Card Required",
      department: "Meat",
      validFrom: "2025-01-01",
      validTill: "2025-01-07",
      disclaimer: "While supplies last",
    };
    const result = formatWeeklyDeal(deal);
    expect(result).toContain("**Ground Beef**");
    expect(result).toContain("80% Lean");
    expect(result).toContain("$3.99/lb (Save $2.00)");
    expect(result).toContain("Loyalty: Card Required");
    expect(result).toContain("Department: Meat");
    expect(result).toContain("Valid: 2025-01-01 - 2025-01-07");
    expect(result).toContain("*While supplies last*");
  });

  it("formats a minimal deal", () => {
    const deal = { product: "Bananas", price: "$0.59/lb" };
    const result = formatWeeklyDeal(deal);
    expect(result).toBe("**Bananas**\n$0.59/lb");
  });
});

describe("formatWeeklyDealsList", () => {
  it("returns empty message for no deals", () => {
    expect(formatWeeklyDealsList([])).toBe("No weekly deals found.");
  });
});

// ----- Pantry Formatting -----

describe("formatPantryItem", () => {
  it("formats a pantry item without expiry", () => {
    const item = {
      productName: "Rice",
      quantity: 2,
      addedAt: "2025-01-15T10:00:00Z",
    };
    const result = formatPantryItem(item);
    expect(result).toContain("**Rice**");
    expect(result).toContain("Quantity: 2");
    expect(result).toContain("Added:");
  });

  it("shows expired label for past expiry dates", () => {
    const item = {
      productName: "Yogurt",
      quantity: 1,
      addedAt: "2025-01-01T00:00:00Z",
      expiresAt: "2020-01-01T00:00:00Z",
    };
    const result = formatPantryItem(item);
    expect(result).toContain("Expired");
  });
});

describe("formatPantryList", () => {
  it("returns empty message for empty pantry", () => {
    expect(formatPantryList([])).toBe("Your pantry is empty.");
  });
});

describe("formatPantryItemCompact", () => {
  it("formats compact pantry item", () => {
    const item = {
      productName: "Milk",
      quantity: 1,
      addedAt: "2025-01-15T00:00:00Z",
    };
    const result = formatPantryItemCompact(item);
    expect(result).toBe("Milk x1");
  });

  it("shows expired indicator for past dates", () => {
    const item = {
      productName: "Eggs",
      quantity: 12,
      addedAt: "2025-01-01T00:00:00Z",
      expiresAt: "2020-01-01T00:00:00Z",
    };
    const result = formatPantryItemCompact(item);
    expect(result).toContain("EXPIRED");
  });
});

describe("formatPantryListCompact", () => {
  it("returns empty message for empty pantry", () => {
    expect(formatPantryListCompact([])).toBe("Pantry empty.");
  });
});

// ----- Order Record Formatting -----

describe("formatOrderRecord", () => {
  it("formats an order with items", () => {
    const order = {
      orderId: "abc-123-def",
      items: [
        { productId: "p1", productName: "Milk", quantity: 2, price: 3.49 },
        { productId: "p2", productName: "Bread", quantity: 1 },
      ],
      totalItems: 3,
      estimatedTotal: 6.98,
      placedAt: "2025-01-20T14:00:00Z",
      locationId: "70500847",
      notes: "Weekly shop",
    };
    const result = formatOrderRecord(order);
    expect(result).toContain("**Order #abc-123-def**");
    expect(result).toContain("Total Items: 3");
    expect(result).toContain("Estimated Total: $6.98");
    expect(result).toContain("Location: 70500847");
    expect(result).toContain("Notes: Weekly shop");
    expect(result).toContain("Milk (2)");
    expect(result).toContain("$3.49");
    expect(result).toContain("Bread (1)");
  });
});

describe("formatOrderHistory", () => {
  it("returns empty message for no orders", () => {
    expect(formatOrderHistory([])).toBe("No order history found.");
  });
});

describe("formatOrderRecordCompact", () => {
  it("formats order with shortened ID", () => {
    const order = {
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
});

describe("formatOrderHistoryCompact", () => {
  it("returns empty message for no orders", () => {
    expect(formatOrderHistoryCompact([])).toBe("No orders.");
  });
});

// ----- Equipment Formatting -----

describe("formatEquipmentItem", () => {
  it("formats equipment with category", () => {
    const item = {
      equipmentName: "Stand Mixer",
      category: "Baking",
      addedAt: "2025-01-10T00:00:00Z",
    };
    const result = formatEquipmentItem(item);
    expect(result).toContain("**Stand Mixer**");
    expect(result).toContain("Category: Baking");
    expect(result).toContain("Added:");
  });

  it("formats equipment without category", () => {
    const item = {
      equipmentName: "Spatula",
      addedAt: "2025-01-10T00:00:00Z",
    };
    const result = formatEquipmentItem(item);
    expect(result).toContain("**Spatula**");
    expect(result).not.toContain("Category:");
  });
});

describe("formatEquipmentList", () => {
  it("returns empty message for no equipment", () => {
    expect(formatEquipmentList([])).toBe("Your equipment list is empty.");
  });
});

describe("formatEquipmentItemCompact", () => {
  it("formats compact equipment with category", () => {
    const item = {
      equipmentName: "Oven",
      category: "Cooking",
      addedAt: "2025-01-01T00:00:00Z",
    };
    expect(formatEquipmentItemCompact(item)).toBe("Oven | Cooking");
  });

  it("formats compact equipment without category", () => {
    const item = {
      equipmentName: "Knife",
      addedAt: "2025-01-01T00:00:00Z",
    };
    expect(formatEquipmentItemCompact(item)).toBe("Knife");
  });
});

describe("formatEquipmentListCompact", () => {
  it("returns empty message for no equipment", () => {
    expect(formatEquipmentListCompact([])).toBe("Equipment list empty.");
  });
});

// ----- Preferred Location Formatting -----

describe("formatPreferredLocation", () => {
  it("formats a preferred location", () => {
    const location = {
      locationId: "70500847",
      locationName: "QFC #815",
      address: "100 Main St, Seattle, WA 98101",
      chain: "QFC",
      setAt: "2025-01-01T00:00:00Z",
    };
    const result = formatPreferredLocation(location);
    expect(result).toContain("**QFC #815**");
    expect(result).toContain("Chain: QFC");
    expect(result).toContain("Address: 100 Main St, Seattle, WA 98101");
    expect(result).toContain("Location ID: 70500847");
    expect(result).toContain("Set:");
  });
});

describe("formatPreferredLocationCompact", () => {
  it("formats compact preferred location", () => {
    const location = {
      locationId: "70500847",
      locationName: "QFC #815",
      address: "100 Main St",
      chain: "QFC",
      setAt: "2025-01-01T00:00:00Z",
    };
    const result = formatPreferredLocationCompact(location);
    expect(result).toBe("QFC #815 (QFC) | 100 Main St | 70500847");
  });
});

// ----- Shopping List Formatting -----

describe("formatShoppingListItem", () => {
  it("formats an unchecked item", () => {
    const item = {
      productName: "Eggs",
      quantity: 1,
      addedAt: "2025-01-15T00:00:00Z",
      checked: false,
    };
    const result = formatShoppingListItem(item);
    expect(result).toContain("[ ] **Eggs**");
    expect(result).toContain("Quantity: 1");
  });

  it("formats a checked item with UPC and notes", () => {
    const item = {
      productName: "Milk",
      quantity: 2,
      upc: "0001111042010",
      notes: "2% preferred",
      addedAt: "2025-01-15T00:00:00Z",
      checked: true,
    };
    const result = formatShoppingListItem(item);
    expect(result).toContain("[x] **Milk**");
    expect(result).toContain("UPC: 0001111042010");
    expect(result).toContain("Notes: 2% preferred");
  });
});

describe("formatShoppingList", () => {
  it("returns empty message for empty list", () => {
    expect(formatShoppingList([])).toBe("Your shopping list is empty.");
  });

  it("separates unchecked and checked items", () => {
    const items = [
      {
        productName: "Bread",
        quantity: 1,
        addedAt: "2025-01-15T00:00:00Z",
        checked: false,
      },
      {
        productName: "Milk",
        quantity: 1,
        addedAt: "2025-01-15T00:00:00Z",
        checked: true,
      },
    ];
    const result = formatShoppingList(items);
    expect(result).toContain("[ ] **Bread**");
    expect(result).toContain("**Already in cart:**");
    expect(result).toContain("[x] **Milk**");
  });
});

describe("formatShoppingListItemCompact", () => {
  it("formats compact unchecked item", () => {
    const item = {
      productName: "Butter",
      quantity: 1,
      addedAt: "2025-01-01T00:00:00Z",
      checked: false,
    };
    expect(formatShoppingListItemCompact(item)).toBe("[ ] Butter x1");
  });

  it("formats compact checked item with UPC and notes", () => {
    const item = {
      productName: "Eggs",
      quantity: 12,
      upc: "0001111042010",
      notes: "large",
      addedAt: "2025-01-01T00:00:00Z",
      checked: true,
    };
    const result = formatShoppingListItemCompact(item);
    expect(result).toBe("[x] Eggs x12 | 0001111042010 | large");
  });
});

describe("formatShoppingListCompact", () => {
  it("returns empty message for empty list", () => {
    expect(formatShoppingListCompact([])).toBe("Shopping list empty.");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createUserStorage,
  EquipmentStorage,
  OrderHistoryStorage,
  PantryStorage,
  PreferredLocationStorage,
  ShoppingListStorage,
} from "../../src/utils/user-storage.js";

/**
 * Creates a mock KVNamespace with in-memory storage for testing.
 */
function createMockKV(): KVNamespace {
  const store = new Map<string, string>();

  return {
    get: vi.fn((key: string) => {
      return Promise.resolve(store.get(key) ?? null);
    }),
    put: vi.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    delete: vi.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

// ----- PreferredLocationStorage -----

describe("PreferredLocationStorage", () => {
  let kv: KVNamespace;
  let storage: PreferredLocationStorage;

  beforeEach(() => {
    kv = createMockKV();
    storage = new PreferredLocationStorage(kv);
  });

  it("returns null when no preferred location is set", async () => {
    const result = await storage.get("user1");
    expect(result).toBeNull();
  });

  it("stores and retrieves a preferred location", async () => {
    const location = {
      locationId: "70500847",
      locationName: "QFC #815",
      address: "100 Main St",
      chain: "QFC",
      setAt: "2025-01-01T00:00:00Z",
    };

    await storage.set("user1", location);
    const result = await storage.get("user1");
    expect(result).toEqual(location);
  });

  it("deletes a preferred location", async () => {
    await storage.set("user1", {
      locationId: "123",
      locationName: "Store",
      address: "Addr",
      chain: "Chain",
      setAt: "2025-01-01T00:00:00Z",
    });

    await storage.delete("user1");
    const result = await storage.get("user1");
    expect(result).toBeNull();
  });

  it("isolates data between users", async () => {
    await storage.set("user1", {
      locationId: "AAA",
      locationName: "Store A",
      address: "A",
      chain: "A",
      setAt: "2025-01-01T00:00:00Z",
    });
    await storage.set("user2", {
      locationId: "BBB",
      locationName: "Store B",
      address: "B",
      chain: "B",
      setAt: "2025-01-01T00:00:00Z",
    });

    const result1 = await storage.get("user1");
    const result2 = await storage.get("user2");
    expect(result1?.locationId).toBe("AAA");
    expect(result2?.locationId).toBe("BBB");
  });
});

// ----- PantryStorage -----

describe("PantryStorage", () => {
  let kv: KVNamespace;
  let storage: PantryStorage;

  beforeEach(() => {
    kv = createMockKV();
    storage = new PantryStorage(kv);
  });

  it("returns empty array for empty pantry", async () => {
    const result = await storage.getAll("user1");
    expect(result).toEqual([]);
  });

  it("adds items to pantry", async () => {
    const item = {
      productName: "Milk",
      quantity: 1,
      addedAt: "2025-01-15T00:00:00Z",
    };

    const result = await storage.add("user1", item);
    expect(result).toHaveLength(1);
    expect(result[0].productName).toBe("Milk");
  });

  it("deduplicates items by name (case-insensitive) and adds quantities", async () => {
    await storage.add("user1", {
      productName: "Milk",
      quantity: 1,
      addedAt: "2025-01-15T00:00:00Z",
    });
    const result = await storage.add("user1", {
      productName: "MILK",
      quantity: 2,
      addedAt: "2025-01-16T00:00:00Z",
    });

    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(3);
    expect(result[0].addedAt).toBe("2025-01-16T00:00:00Z");
  });

  it("removes an item by name (case-insensitive)", async () => {
    await storage.add("user1", {
      productName: "Eggs",
      quantity: 12,
      addedAt: "2025-01-15T00:00:00Z",
    });

    const result = await storage.remove("user1", "EGGS");
    expect(result).toHaveLength(0);
  });

  it("updates quantity of an existing item", async () => {
    await storage.add("user1", {
      productName: "Rice",
      quantity: 1,
      addedAt: "2025-01-15T00:00:00Z",
    });

    const result = await storage.updateQuantity("user1", "rice", 5);
    expect(result[0].quantity).toBe(5);
  });

  it("clears all pantry items", async () => {
    await storage.add("user1", {
      productName: "A",
      quantity: 1,
      addedAt: "2025-01-01T00:00:00Z",
    });
    await storage.add("user1", {
      productName: "B",
      quantity: 2,
      addedAt: "2025-01-01T00:00:00Z",
    });

    await storage.clear("user1");
    const result = await storage.getAll("user1");
    expect(result).toEqual([]);
  });
});

// ----- EquipmentStorage -----

describe("EquipmentStorage", () => {
  let kv: KVNamespace;
  let storage: EquipmentStorage;

  beforeEach(() => {
    kv = createMockKV();
    storage = new EquipmentStorage(kv);
  });

  it("returns empty array for no equipment", async () => {
    expect(await storage.getAll("user1")).toEqual([]);
  });

  it("adds equipment items", async () => {
    const item = {
      equipmentName: "Stand Mixer",
      category: "Baking",
      addedAt: "2025-01-01T00:00:00Z",
    };
    const result = await storage.add("user1", item);
    expect(result).toHaveLength(1);
    expect(result[0].equipmentName).toBe("Stand Mixer");
  });

  it("deduplicates equipment by name (case-insensitive) and updates category", async () => {
    await storage.add("user1", {
      equipmentName: "Oven",
      category: "Cooking",
      addedAt: "2025-01-01T00:00:00Z",
    });
    const result = await storage.add("user1", {
      equipmentName: "OVEN",
      category: "Baking",
      addedAt: "2025-01-02T00:00:00Z",
    });

    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("Baking");
  });

  it("removes equipment by name (case-insensitive)", async () => {
    await storage.add("user1", {
      equipmentName: "Knife",
      addedAt: "2025-01-01T00:00:00Z",
    });
    const result = await storage.remove("user1", "knife");
    expect(result).toHaveLength(0);
  });

  it("clears all equipment", async () => {
    await storage.add("user1", {
      equipmentName: "A",
      addedAt: "2025-01-01T00:00:00Z",
    });
    await storage.clear("user1");
    expect(await storage.getAll("user1")).toEqual([]);
  });
});

// ----- ShoppingListStorage -----

describe("ShoppingListStorage", () => {
  let kv: KVNamespace;
  let storage: ShoppingListStorage;

  beforeEach(() => {
    kv = createMockKV();
    storage = new ShoppingListStorage(kv);
  });

  it("returns empty array for no items", async () => {
    expect(await storage.getAll("user1")).toEqual([]);
  });

  it("adds items to shopping list", async () => {
    const item = {
      productName: "Bread",
      quantity: 1,
      addedAt: "2025-01-01T00:00:00Z",
      checked: false,
    };
    const result = await storage.add("user1", item);
    expect(result).toHaveLength(1);
  });

  it("deduplicates by name and adds quantities", async () => {
    await storage.add("user1", {
      productName: "Milk",
      quantity: 1,
      addedAt: "2025-01-01T00:00:00Z",
      checked: false,
    });
    const result = await storage.add("user1", {
      productName: "milk",
      quantity: 2,
      upc: "0001111042010",
      notes: "2%",
      addedAt: "2025-01-02T00:00:00Z",
      checked: false,
    });

    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(3);
    expect(result[0].upc).toBe("0001111042010");
    expect(result[0].notes).toBe("2%");
  });

  it("removes item by name (case-insensitive)", async () => {
    await storage.add("user1", {
      productName: "Eggs",
      quantity: 1,
      addedAt: "2025-01-01T00:00:00Z",
      checked: false,
    });
    const result = await storage.remove("user1", "EGGS");
    expect(result).toHaveLength(0);
  });

  it("updates item fields", async () => {
    await storage.add("user1", {
      productName: "Butter",
      quantity: 1,
      addedAt: "2025-01-01T00:00:00Z",
      checked: false,
    });

    await storage.updateItem("user1", "butter", {
      quantity: 3,
      checked: true,
      notes: "salted",
    });

    const items = await storage.getAll("user1");
    expect(items[0].quantity).toBe(3);
    expect(items[0].checked).toBe(true);
    expect(items[0].notes).toBe("salted");
  });

  it("returns only unchecked items", async () => {
    await storage.add("user1", {
      productName: "A",
      quantity: 1,
      addedAt: "2025-01-01T00:00:00Z",
      checked: false,
    });
    await storage.add("user1", {
      productName: "B",
      quantity: 1,
      addedAt: "2025-01-01T00:00:00Z",
      checked: true,
    });

    const unchecked = await storage.getUnchecked("user1");
    expect(unchecked).toHaveLength(1);
    expect(unchecked[0].productName).toBe("A");
  });

  it("marks all items as checked", async () => {
    await storage.add("user1", {
      productName: "A",
      quantity: 1,
      addedAt: "2025-01-01T00:00:00Z",
      checked: false,
    });
    await storage.add("user1", {
      productName: "B",
      quantity: 1,
      addedAt: "2025-01-01T00:00:00Z",
      checked: false,
    });

    const result = await storage.markAllChecked("user1");
    expect(result.every((i) => i.checked)).toBe(true);
  });

  it("clears the shopping list", async () => {
    await storage.add("user1", {
      productName: "X",
      quantity: 1,
      addedAt: "2025-01-01T00:00:00Z",
      checked: false,
    });
    await storage.clear("user1");
    expect(await storage.getAll("user1")).toEqual([]);
  });
});

// ----- OrderHistoryStorage -----

describe("OrderHistoryStorage", () => {
  let kv: KVNamespace;
  let storage: OrderHistoryStorage;

  beforeEach(() => {
    kv = createMockKV();
    storage = new OrderHistoryStorage(kv);
  });

  it("returns empty array for no orders", async () => {
    expect(await storage.getAll("user1")).toEqual([]);
  });

  it("adds orders to history (most recent first)", async () => {
    const order1 = {
      orderId: "order-1",
      items: [],
      totalItems: 1,
      placedAt: "2025-01-01T00:00:00Z",
    };
    const order2 = {
      orderId: "order-2",
      items: [],
      totalItems: 2,
      placedAt: "2025-01-02T00:00:00Z",
    };

    await storage.add("user1", order1);
    await storage.add("user1", order2);

    const result = await storage.getAll("user1");
    expect(result).toHaveLength(2);
    expect(result[0].orderId).toBe("order-2");
    expect(result[1].orderId).toBe("order-1");
  });

  it("limits order history to 50 entries", async () => {
    for (let i = 0; i < 55; i++) {
      await storage.add("user1", {
        orderId: `order-${i}`,
        items: [],
        totalItems: i,
        placedAt: `2025-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      });
    }

    const result = await storage.getAll("user1");
    expect(result).toHaveLength(50);
  });

  it("gets recent orders with limit", async () => {
    for (let i = 0; i < 10; i++) {
      await storage.add("user1", {
        orderId: `order-${i}`,
        items: [],
        totalItems: 1,
        placedAt: "2025-01-01T00:00:00Z",
      });
    }

    const recent = await storage.getRecent("user1", 3);
    expect(recent).toHaveLength(3);
  });

  it("clears order history", async () => {
    await storage.add("user1", {
      orderId: "order-1",
      items: [],
      totalItems: 1,
      placedAt: "2025-01-01T00:00:00Z",
    });
    await storage.clear("user1");
    expect(await storage.getAll("user1")).toEqual([]);
  });
});

// ----- createUserStorage factory -----

describe("createUserStorage", () => {
  it("creates all storage instances", () => {
    const kv = createMockKV();
    const storage = createUserStorage(kv);

    expect(storage.preferredLocation).toBeInstanceOf(PreferredLocationStorage);
    expect(storage.pantry).toBeInstanceOf(PantryStorage);
    expect(storage.equipment).toBeInstanceOf(EquipmentStorage);
    expect(storage.orderHistory).toBeInstanceOf(OrderHistoryStorage);
    expect(storage.shoppingList).toBeInstanceOf(ShoppingListStorage);
  });
});

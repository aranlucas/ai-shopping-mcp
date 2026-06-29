import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  EquipmentStorage,
  OrderHistoryStorage,
  PantryStorage,
  PreferredLocationStorage,
  ShoppingListStorage,
  createUserStorage,
} from "../../src/utils/user-storage.js";

/**
 * Creates a mock KVNamespace with in-memory storage for testing.
 * Accepts optional initial data to pre-seed the store (e.g., with corrupted JSON).
 */
function createMockKV(initialData: Record<string, string> = {}): KVNamespace {
  const store = new Map<string, string>(Object.entries(initialData));

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

// ----- parseJson fallback on corrupted KV data -----

describe("parseJson fallback on corrupted KV data", () => {
  it("PreferredLocationStorage.get returns null for invalid JSON", async () => {
    const kv = createMockKV({ "user:user1:preferred_location": "{ not valid json }" });
    const storage = new PreferredLocationStorage(kv);
    const result = await storage.get("user1");
    expect(result).toBeNull();
  });

  it("PantryStorage.getAll returns empty array for invalid JSON", async () => {
    const kv = createMockKV({ "user:user1:pantry": "][" });
    const storage = new PantryStorage(kv);
    const result = await storage.getAll("user1");
    expect(result).toEqual([]);
  });

  it("EquipmentStorage.getAll returns empty array for invalid JSON", async () => {
    const kv = createMockKV({ "user:user1:equipment": "{unclosed" });
    const storage = new EquipmentStorage(kv);
    const result = await storage.getAll("user1");
    expect(result).toEqual([]);
  });

  it("ShoppingListStorage.getAll returns empty array for invalid JSON", async () => {
    const kv = createMockKV({ "user:user1:shopping_list": "not-json-at-all" });
    const storage = new ShoppingListStorage(kv);
    const result = await storage.getAll("user1");
    expect(result).toEqual([]);
  });

  it("OrderHistoryStorage.getAll returns empty array for invalid JSON", async () => {
    const kv = createMockKV({ "user:user1:order_history": "{{bad}}" });
    const storage = new OrderHistoryStorage(kv);
    const result = await storage.getAll("user1");
    expect(result).toEqual([]);
  });
});

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

  it("updateQuantity returns pantry unchanged when product name does not match", async () => {
    await storage.add("user1", {
      productName: "Eggs",
      quantity: 6,
      addedAt: "2025-01-15T00:00:00Z",
    });

    const result = await storage.updateQuantity("user1", "Milk", 99);

    expect(result).toHaveLength(1);
    expect(result[0].productName).toBe("Eggs");
    expect(result[0].quantity).toBe(6);
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

  it("isolates pantry data between users", async () => {
    await storage.add("user1", {
      productName: "Milk",
      quantity: 2,
      addedAt: "2025-01-01T00:00:00Z",
    });
    await storage.add("user2", {
      productName: "Eggs",
      quantity: 12,
      addedAt: "2025-01-01T00:00:00Z",
    });

    const user1Items = await storage.getAll("user1");
    const user2Items = await storage.getAll("user2");

    expect(user1Items).toHaveLength(1);
    expect(user1Items[0].productName).toBe("Milk");
    expect(user2Items).toHaveLength(1);
    expect(user2Items[0].productName).toBe("Eggs");
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

  it("preserves existing category when duplicate item has no category", async () => {
    await storage.add("user1", {
      equipmentName: "Blender",
      category: "Appliances",
      addedAt: "2025-01-01T00:00:00Z",
    });
    const result = await storage.add("user1", {
      equipmentName: "blender",
      addedAt: "2025-01-02T00:00:00Z",
    });

    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("Appliances");
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

  it("isolates equipment data between users", async () => {
    await storage.add("user1", {
      equipmentName: "Stand Mixer",
      category: "Baking",
      addedAt: "2025-01-01T00:00:00Z",
    });
    await storage.add("user2", {
      equipmentName: "Wok",
      category: "Cooking",
      addedAt: "2025-01-01T00:00:00Z",
    });

    const user1Items = await storage.getAll("user1");
    const user2Items = await storage.getAll("user2");

    expect(user1Items).toHaveLength(1);
    expect(user1Items[0].equipmentName).toBe("Stand Mixer");
    expect(user2Items).toHaveLength(1);
    expect(user2Items[0].equipmentName).toBe("Wok");
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

  it("preserves existing UPC when duplicate item has no UPC", async () => {
    await storage.add("user1", {
      productName: "Whole Milk",
      upc: "0001111042010",
      quantity: 1,
      addedAt: "2025-01-01T00:00:00Z",
      checked: false,
    });
    const result = await storage.add("user1", {
      productName: "Whole Milk",
      quantity: 1,
      addedAt: "2025-01-02T00:00:00Z",
      checked: false,
    });

    expect(result).toHaveLength(1);
    expect(result[0].upc).toBe("0001111042010");
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

  it("updateItem returns list unchanged when product name does not match", async () => {
    await storage.add("user1", {
      productName: "Butter",
      quantity: 1,
      addedAt: "2025-01-01T00:00:00Z",
      checked: false,
    });

    const result = await storage.updateItem("user1", "Cheese", {
      quantity: 99,
      checked: true,
    });

    expect(result).toHaveLength(1);
    expect(result[0].productName).toBe("Butter");
    expect(result[0].quantity).toBe(1);
    expect(result[0].checked).toBe(false);
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

  it("isolates shopping list data between users", async () => {
    await storage.add("user1", {
      productName: "Bread",
      quantity: 1,
      addedAt: "2025-01-01T00:00:00Z",
      checked: false,
    });
    await storage.add("user2", {
      productName: "Cheese",
      quantity: 2,
      addedAt: "2025-01-01T00:00:00Z",
      checked: false,
    });

    const user1List = await storage.getAll("user1");
    const user2List = await storage.getAll("user2");

    expect(user1List).toHaveLength(1);
    expect(user1List[0].productName).toBe("Bread");
    expect(user2List).toHaveLength(1);
    expect(user2List[0].productName).toBe("Cheese");
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

  it("gets recent orders with an explicit limit", async () => {
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

  it("getRecent uses default limit of 10 when no limit is provided", async () => {
    for (let i = 0; i < 15; i++) {
      await storage.add("user1", {
        orderId: `order-${i}`,
        items: [],
        totalItems: 1,
        placedAt: "2025-01-01T00:00:00Z",
      });
    }

    const recent = await storage.getRecent("user1");
    expect(recent).toHaveLength(10);
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

  it("isolates order history between users", async () => {
    await storage.add("user1", {
      orderId: "order-A",
      items: [],
      totalItems: 1,
      placedAt: "2025-01-01T00:00:00Z",
    });
    await storage.add("user2", {
      orderId: "order-B",
      items: [],
      totalItems: 2,
      placedAt: "2025-01-01T00:00:00Z",
    });

    const user1Orders = await storage.getAll("user1");
    const user2Orders = await storage.getAll("user2");

    expect(user1Orders).toHaveLength(1);
    expect(user1Orders[0].orderId).toBe("order-A");
    expect(user2Orders).toHaveLength(1);
    expect(user2Orders[0].orderId).toBe("order-B");
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

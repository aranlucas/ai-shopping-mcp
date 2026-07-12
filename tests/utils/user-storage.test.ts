import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CorruptPersistenceEntryError,
  createShoppingPersistence,
} from "../../src/utils/user-storage.js";

function createMockKV(initialData: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initialData));
  const get = vi.fn((key: string) => Promise.resolve(store.get(key) ?? null));
  const put = vi.fn((key: string, value: string) => {
    store.set(key, value);
    return Promise.resolve();
  });
  const del = vi.fn((key: string) => {
    store.delete(key);
    return Promise.resolve();
  });
  return {
    kv: { get, put, delete: del },
    store,
    get,
    put,
    delete: del,
  };
}

describe("ShoppingPersistence", () => {
  const identity = { userId: "user1", sessionId: "session1" };
  let mock: ReturnType<typeof createMockKV>;

  beforeEach(() => {
    mock = createMockKV();
  });

  it("binds user identity for preferred location", async () => {
    const storage = createShoppingPersistence(mock.kv, identity);
    const location = {
      locationId: "70500847",
      locationName: "QFC",
      address: "100 Main St",
      chain: "QFC",
      setAt: "2026-07-12T00:00:00.000Z",
    };

    await storage.preferredLocation.set(location);

    expect(mock.put).toHaveBeenCalledWith(
      "user:user1:preferred_location",
      JSON.stringify(location),
    );
    expect(await storage.preferredLocation.get()).toEqual(location);
  });

  it("keeps profile state user-scoped across sessions", async () => {
    const first = createShoppingPersistence(mock.kv, identity);
    const second = createShoppingPersistence(mock.kv, { ...identity, sessionId: "session2" });
    await first.pantry.add({
      productName: "Milk",
      quantity: 1,
      addedAt: "2026-07-12T00:00:00.000Z",
    });
    expect(await second.pantry.getAll()).toHaveLength(1);
  });

  it("isolates profile state between users", async () => {
    const first = createShoppingPersistence(mock.kv, identity);
    const second = createShoppingPersistence(mock.kv, {
      userId: "user2",
      sessionId: identity.sessionId,
    });
    await first.pantry.add({
      productName: "Milk",
      quantity: 1,
      addedAt: "2026-07-12T00:00:00.000Z",
    });
    expect(await second.pantry.getAll()).toEqual([]);
  });

  it("batch-adds pantry items with one read and one write", async () => {
    const storage = createShoppingPersistence(mock.kv, identity);
    await storage.pantry.add([
      { productName: "Milk", quantity: 1, addedAt: "first" },
      { productName: "MILK", quantity: 2, addedAt: "second" },
      { productName: "Eggs", quantity: 12, addedAt: "second" },
    ]);

    expect(mock.get).toHaveBeenCalledTimes(1);
    expect(mock.put).toHaveBeenCalledTimes(1);
    expect(await storage.pantry.getAll()).toEqual([
      { productName: "Milk", quantity: 3, addedAt: "second" },
      { productName: "Eggs", quantity: 12, addedAt: "second" },
    ]);
  });

  it("batch-removes pantry items case-insensitively with one write", async () => {
    const storage = createShoppingPersistence(mock.kv, identity);
    await storage.pantry.add([
      { productName: "Milk", quantity: 1, addedAt: "now" },
      { productName: "Eggs", quantity: 1, addedAt: "now" },
      { productName: "Rice", quantity: 1, addedAt: "now" },
    ]);
    mock.get.mockClear();
    mock.put.mockClear();

    expect(await storage.pantry.remove(["MILK", "eggs"])).toEqual([
      { productName: "Rice", quantity: 1, addedAt: "now" },
    ]);
    expect(mock.get).toHaveBeenCalledTimes(1);
    expect(mock.put).toHaveBeenCalledTimes(1);
  });

  it("preserves equipment category when a duplicate omits it", async () => {
    const storage = createShoppingPersistence(mock.kv, identity);
    await storage.equipment.add({ equipmentName: "Blender", category: "Appliance", addedAt: "a" });
    const result = await storage.equipment.add({ equipmentName: "BLENDER", addedAt: "b" });
    expect(result).toEqual([{ equipmentName: "Blender", category: "Appliance", addedAt: "b" }]);
  });

  it("uses the deployed user-and-session list key and seven-day TTL", async () => {
    const storage = createShoppingPersistence(
      mock.kv,
      identity,
      () => new Date("2026-07-12T00:00:00.000Z"),
    );
    await storage.shoppingList.create("list_deadbeef", "Dinner", [
      { productName: "Milk", quantity: 1 },
    ]);
    expect(mock.put).toHaveBeenCalledWith(
      "shopping_list:user1:session:session1:list:list_deadbeef",
      expect.any(String),
      { expirationTtl: 604800 },
    );
  });

  it("isolates shopping lists by session", async () => {
    const first = createShoppingPersistence(mock.kv, identity);
    const second = createShoppingPersistence(mock.kv, { ...identity, sessionId: "session2" });
    await first.shoppingList.create("list_deadbeef", "Dinner", [
      { productName: "Milk", quantity: 1 },
    ]);
    expect(await second.shoppingList.get("list_deadbeef")).toBeNull();
  });

  it("uses the deployed receipt key and seven-day TTL", async () => {
    const storage = createShoppingPersistence(mock.kv, identity);
    const items = [{ upc: "0001111042578", quantity: 1, modality: "PICKUP" as const }];
    await storage.cartSnapshot.set("list_deadbeef", items);
    expect(mock.put).toHaveBeenCalledWith(
      "user:user1:session:session1:list:list_deadbeef:cart_snapshot",
      JSON.stringify(items),
      { expirationTtl: 604800 },
    );
  });

  it("caps the cart mirror at 100 and renews its seven-day TTL", async () => {
    const initial = Array.from({ length: 100 }, (_, index) => ({
      upc: String(index).padStart(13, "0"),
      quantity: 1,
      modality: "PICKUP",
      addedAt: "old",
    }));
    mock = createMockKV({ "user:user1:cart_mirror": JSON.stringify(initial) });
    const storage = createShoppingPersistence(mock.kv, identity);
    const result = await storage.cartMirror.append(
      [{ upc: "9999999999999", quantity: 1, modality: "DELIVERY" }],
      "new",
    );
    expect(result).toHaveLength(100);
    expect(result.at(-1)?.upc).toBe("9999999999999");
    expect(mock.put).toHaveBeenCalledWith("user:user1:cart_mirror", expect.any(String), {
      expirationTtl: 604800,
    });
  });

  it("keeps only the 50 newest orders", async () => {
    const storage = createShoppingPersistence(mock.kv, identity);
    for (let index = 0; index < 55; index++) {
      await storage.orderHistory.add({
        orderId: `order-${index}`,
        items: [],
        totalItems: 0,
        placedAt: String(index),
      });
    }
    const history = await storage.orderHistory.getAll();
    expect(history).toHaveLength(50);
    expect(history[0]?.orderId).toBe("order-54");
  });

  it("does not overwrite corrupt collections as empty during mutation", async () => {
    mock = createMockKV({ "user:user1:pantry": "{broken" });
    const storage = createShoppingPersistence(mock.kv, identity);
    await expect(
      storage.pantry.add({ productName: "Milk", quantity: 1, addedAt: "now" }),
    ).rejects.toBeInstanceOf(CorruptPersistenceEntryError);
    expect(mock.put).not.toHaveBeenCalled();
  });

  it("keeps tolerant read fallbacks for missing and corrupt optional data", async () => {
    const missing = createShoppingPersistence(mock.kv, identity);
    expect(await missing.preferredLocation.get()).toBeNull();

    mock = createMockKV({ "user:user1:preferred_location": "[]" });
    const corrupt = createShoppingPersistence(mock.kv, identity);
    expect(await corrupt.preferredLocation.get()).toBeNull();
  });

  it("keeps cart retry receipts strict because corruption cannot prove idempotency", async () => {
    mock = createMockKV({
      "user:user1:session:session1:list:list_deadbeef:cart_snapshot": "{broken",
    });
    const storage = createShoppingPersistence(mock.kv, identity);
    await expect(storage.cartSnapshot.get("list_deadbeef")).rejects.toBeInstanceOf(
      CorruptPersistenceEntryError,
    );
  });

  it("resolves identity lazily for request-scoped Worker auth", async () => {
    let current = identity;
    const storage = createShoppingPersistence(mock.kv, () => current);
    await storage.cartId.set("cart-a");
    current = { userId: "user2", sessionId: "session2" };
    expect(await storage.cartId.get()).toBeNull();
  });
});

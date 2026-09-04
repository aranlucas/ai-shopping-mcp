import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CorruptPersistenceEntryError,
  createCartPersistence,
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

describe("CartPersistence", () => {
  const identity = { userId: "user1", clientId: "client1" };
  let mock: ReturnType<typeof createMockKV>;

  beforeEach(() => {
    mock = createMockKV();
  });

  it("uses the deployed receipt key and seven-day TTL", async () => {
    const carts = createCartPersistence(mock.kv, identity);
    const items = [{ upc: "0001111042578", quantity: 1, modality: "PICKUP" as const }];
    await carts.cartSnapshot.set("list_deadbeef", items);
    expect(mock.put).toHaveBeenCalledWith(
      "user:user1:client:client1:list:list_deadbeef:cart_snapshot",
      JSON.stringify(items),
      { expirationTtl: 604800 },
    );
  });

  it("isolates cart receipts by authenticated client", async () => {
    const first = createCartPersistence(mock.kv, identity);
    const second = createCartPersistence(mock.kv, { ...identity, clientId: "client2" });
    await first.cartSnapshot.set("list_deadbeef", [
      { upc: "0001111042578", quantity: 1, modality: "PICKUP" },
    ]);
    expect(await second.cartSnapshot.get("list_deadbeef")).toBeNull();
  });

  it("caps the cart mirror at 100 and renews its seven-day TTL", async () => {
    const initial = Array.from({ length: 100 }, (_, index) => ({
      upc: String(index).padStart(13, "0"),
      quantity: 1,
      modality: "PICKUP",
      addedAt: "old",
    }));
    mock = createMockKV({ "user:user1:cart_mirror": JSON.stringify(initial) });
    const carts = createCartPersistence(mock.kv, identity);
    const result = await carts.cartMirror.append(
      [{ upc: "9999999999999", quantity: 1, modality: "DELIVERY" }],
      "new",
    );
    expect(result).toHaveLength(100);
    expect(result.at(-1)?.upc).toBe("9999999999999");
    expect(mock.put).toHaveBeenCalledWith("user:user1:cart_mirror", expect.any(String), {
      expirationTtl: 604800,
    });
  });

  it("keeps cart retry receipts strict because corruption cannot prove idempotency", async () => {
    mock = createMockKV({
      "user:user1:client:client1:list:list_deadbeef:cart_snapshot": "{broken",
    });
    const carts = createCartPersistence(mock.kv, identity);
    await expect(carts.cartSnapshot.get("list_deadbeef")).rejects.toBeInstanceOf(
      CorruptPersistenceEntryError,
    );
  });

  it("tolerates a corrupt cart mirror read without overwriting it", async () => {
    mock = createMockKV({ "user:user1:cart_mirror": "{broken" });
    const carts = createCartPersistence(mock.kv, identity);
    expect(await carts.cartMirror.getAll()).toEqual([]);
    expect(mock.put).not.toHaveBeenCalled();
  });

  it("resolves identity lazily for request-scoped Worker auth", async () => {
    let current = identity;
    const carts = createCartPersistence(mock.kv, () => current);
    await carts.cartId.set("cart-a");
    current = { userId: "user2", clientId: "client2" };
    expect(await carts.cartId.get()).toBeNull();
  });
});

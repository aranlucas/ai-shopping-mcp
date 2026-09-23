import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { createD1ShoppingStore } from "../src/utils/d1-shopping-storage.js";
import { ensureShoppingSchema } from "./d1-schema.js";

beforeAll(ensureShoppingSchema);

function shopper() {
  return createD1ShoppingStore(env.SHOPPING_DB, crypto.randomUUID());
}

describe("D1 shopping storage", () => {
  it("stores preferred location, pantry, and equipment for one shopper", async () => {
    const user = shopper();
    const other = shopper();
    const now = "2026-09-23T00:00:00.000Z";
    const location = {
      locationId: "70500847",
      locationName: "QFC",
      address: "123 Main St",
      chain: "QFC",
      setAt: now,
    };

    await user.preferredLocation.set(location);
    await user.pantry.add({ productName: "Eggs", quantity: 6, addedAt: now });
    await user.pantry.add({ productName: "eggs", quantity: 2, addedAt: now });
    await user.equipment.add({ equipmentName: "Skillet", addedAt: now });

    expect(await user.preferredLocation.get()).toEqual(location);
    expect(await user.pantry.getAll()).toMatchObject([{ quantity: 8 }]);
    expect(await user.equipment.getAll()).toHaveLength(1);
    expect(await other.preferredLocation.get()).toBeNull();
    expect(await other.pantry.getAll()).toEqual([]);
    expect(await other.equipment.getAll()).toEqual([]);

    await user.pantry.updateQuantity("EGGS", 4);
    expect(await user.pantry.getAll()).toMatchObject([{ quantity: 4 }]);
    await user.pantry.remove("eggs");
    await user.equipment.remove("SKILLET");
    await user.preferredLocation.delete();
    expect(await user.pantry.getAll()).toEqual([]);
    expect(await user.equipment.getAll()).toEqual([]);
    expect(await user.preferredLocation.get()).toBeNull();
  });

  it("edits lists and keeps list IDs inaccessible to another shopper", async () => {
    const user = shopper();
    const other = shopper();
    const created = await user.shoppingList.create({
      name: "Dinner",
      items: [{ productName: "Tomatoes", quantity: 2 }],
    });
    expect(created.items[0]).toMatchObject({ checked: false, quantity: 2 });
    expect(await other.shoppingList.get(created.id)).toBeNull();
    await expect(
      other.shoppingList.addItems(created.id, [
        { productName: "Onions", quantity: 1 },
      ]),
    ).rejects.toThrow(`No shopping list ${created.id}`);

    const [added] = await user.shoppingList.addItems(created.id, [
      { productName: "Onions", quantity: 1 },
    ]);
    expect(added).toBeDefined();
    if (!added) throw new Error("Expected the added item");
    const edited = await user.shoppingList.updateItem(created.id, added.id, {
      quantity: 3,
      checked: true,
    });
    expect(edited).toMatchObject({ quantity: 3, checked: true });
    expect((await user.shoppingList.get(created.id))?.items).toHaveLength(2);
    expect(await user.shoppingList.list()).toMatchObject([
      { id: created.id, itemCount: 2 },
    ]);
    await user.shoppingList.removeItem(created.id, added.id);
    expect((await user.shoppingList.get(created.id))?.items).toHaveLength(1);
    expect(await other.shoppingList.list()).toEqual([]);
  });

  it("persists order history by shopper", async () => {
    const user = shopper();
    const other = shopper();
    const order = {
      orderId: crypto.randomUUID(),
      items: [{ productName: "Milk", quantity: 1, upc: "0001111042578" }],
      totalItems: 1,
      placedAt: "2026-09-23T00:00:00.000Z",
    };
    await user.orderHistory.add(order);
    expect(await user.orderHistory.getRecent()).toEqual([order]);
    expect(await other.orderHistory.getAll()).toEqual([]);
  });
});

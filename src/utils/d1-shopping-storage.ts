import { and, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import type {
  EquipmentItem,
  OrderRecord,
  PantryItem,
  ShoppingList,
  ShoppingListItem,
  ShoppingListItemPatch,
  StoredShoppingListItem,
} from "../domain/shopping.js";
import type { ShoppingStore } from "./shopping-store.js";

import {
  equipmentItems,
  orderHistory,
  pantryItems,
  preferredStores,
  shoppingLists,
} from "../db/schema.js";
import { AppErrorException, notFoundError, storageError } from "../errors.js";

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

function newListItems(items: ShoppingListItem[]): StoredShoppingListItem[] {
  return items.map((item) => ({
    ...item,
    id: `item_${crypto.randomUUID().replaceAll("-", "")}`,
    checked: false,
  }));
}

function listFromRow(row: typeof shoppingLists.$inferSelect): ShoppingList {
  return {
    id: row.id,
    name: row.name,
    items: row.items,
    createdAt: row.createdAt,
  };
}

/** D1-backed shopping records for one authenticated Kroger shopper. */
export function createD1ShoppingStore(
  binding: D1Database,
  userId: string,
): ShoppingStore {
  const db = drizzle(binding);

  const getPantry = async () => {
    const rows = await db
      .select()
      .from(pantryItems)
      .where(eq(pantryItems.userId, userId))
      .all();
    return rows.map((row) => {
      const item: PantryItem = {
        productName: row.productName,
        quantity: row.quantity,
        addedAt: row.addedAt,
      };
      if (row.expiresAt !== null) item.expiresAt = row.expiresAt;
      return item;
    });
  };

  const getEquipment = async () => {
    const rows = await db
      .select()
      .from(equipmentItems)
      .where(eq(equipmentItems.userId, userId))
      .all();
    return rows.map((row) => {
      const item: EquipmentItem = {
        equipmentName: row.equipmentName,
        addedAt: row.addedAt,
      };
      if (row.category !== null) item.category = row.category;
      return item;
    });
  };

  const getListRow = (listId: string) =>
    db
      .select()
      .from(shoppingLists)
      .where(
        and(eq(shoppingLists.id, listId), eq(shoppingLists.userId, userId)),
      )
      .get();

  const mutateList = async <T>(
    listId: string,
    mutate: (items: StoredShoppingListItem[]) => {
      items: StoredShoppingListItem[];
      result: T;
    },
  ): Promise<T> => {
    for (let attempt = 0; attempt < 5; attempt++) {
      // Each retry must read the version written by the preceding attempt.
      // eslint-disable-next-line no-await-in-loop
      const row = await getListRow(listId);
      if (!row) {
        throw new AppErrorException(
          notFoundError(`No shopping list ${listId}.`),
        );
      }
      const changed = mutate(row.items);
      // eslint-disable-next-line no-await-in-loop
      const updated = await db
        .update(shoppingLists)
        .set({
          items: changed.items,
          updatedAt: new Date().toISOString(),
          version: sql`${shoppingLists.version} + 1`,
        })
        .where(
          and(
            eq(shoppingLists.id, listId),
            eq(shoppingLists.userId, userId),
            eq(shoppingLists.version, row.version),
          ),
        )
        .run();
      if (updated.meta.changes === 1) return changed.result;
    }
    throw new AppErrorException(
      storageError("Shopping list changed concurrently. Retry the edit."),
    );
  };

  const getOrders = async (limit: number): Promise<OrderRecord[]> => {
    const rows = await db
      .select({ record: orderHistory.record })
      .from(orderHistory)
      .where(eq(orderHistory.userId, userId))
      .orderBy(desc(orderHistory.placedAt))
      .limit(limit)
      .all();
    return rows.map((row) => row.record);
  };

  return {
    preferredLocation: {
      get: async () => {
        const row = await db
          .select()
          .from(preferredStores)
          .where(eq(preferredStores.userId, userId))
          .get();
        return row
          ? {
              locationId: row.locationId,
              locationName: row.locationName,
              address: row.address,
              chain: row.chain,
              setAt: row.setAt,
            }
          : null;
      },
      set: async (location) => {
        await db
          .insert(preferredStores)
          .values({
            userId,
            locationId: location.locationId,
            locationName: location.locationName,
            address: location.address,
            chain: location.chain,
            setAt: location.setAt,
          })
          .onConflictDoUpdate({
            target: preferredStores.userId,
            set: {
              locationId: location.locationId,
              locationName: location.locationName,
              address: location.address,
              chain: location.chain,
              setAt: location.setAt,
            },
          })
          .run();
      },
      delete: async () => {
        await db
          .delete(preferredStores)
          .where(eq(preferredStores.userId, userId))
          .run();
      },
    },
    pantry: {
      getAll: getPantry,
      add: async (items) => {
        const entries = Array.isArray(items) ? items : [items];
        for (const item of entries) {
          // Keep duplicate item names in request order when quantities merge.
          // eslint-disable-next-line no-await-in-loop
          await db
            .insert(pantryItems)
            .values({
              userId,
              nameKey: nameKey(item.productName),
              productName: item.productName,
              quantity: item.quantity,
              addedAt: item.addedAt,
              expiresAt: item.expiresAt ?? null,
            })
            .onConflictDoUpdate({
              target: [pantryItems.userId, pantryItems.nameKey],
              set: {
                quantity: sql`${pantryItems.quantity} + excluded.quantity`,
                addedAt: item.addedAt,
                expiresAt: sql`COALESCE(excluded.expires_at, ${pantryItems.expiresAt})`,
              },
            })
            .run();
        }
        return getPantry();
      },
      remove: async (names) => {
        for (const name of Array.isArray(names) ? names : [names]) {
          // eslint-disable-next-line no-await-in-loop
          await db
            .delete(pantryItems)
            .where(
              and(
                eq(pantryItems.userId, userId),
                eq(pantryItems.nameKey, nameKey(name)),
              ),
            )
            .run();
        }
        return getPantry();
      },
      updateQuantity: async (productName, quantity) => {
        await db
          .update(pantryItems)
          .set({ quantity })
          .where(
            and(
              eq(pantryItems.userId, userId),
              eq(pantryItems.nameKey, nameKey(productName)),
            ),
          )
          .run();
        return getPantry();
      },
      clear: async () => {
        await db
          .delete(pantryItems)
          .where(eq(pantryItems.userId, userId))
          .run();
      },
    },
    equipment: {
      getAll: getEquipment,
      add: async (items) => {
        const entries = Array.isArray(items) ? items : [items];
        for (const item of entries) {
          // Keep duplicate item names in request order when metadata merges.
          // eslint-disable-next-line no-await-in-loop
          await db
            .insert(equipmentItems)
            .values({
              userId,
              nameKey: nameKey(item.equipmentName),
              equipmentName: item.equipmentName,
              category: item.category ?? null,
              addedAt: item.addedAt,
            })
            .onConflictDoUpdate({
              target: [equipmentItems.userId, equipmentItems.nameKey],
              set: {
                category: sql`COALESCE(excluded.category, ${equipmentItems.category})`,
                addedAt: item.addedAt,
              },
            })
            .run();
        }
        return getEquipment();
      },
      remove: async (names) => {
        for (const name of Array.isArray(names) ? names : [names]) {
          // eslint-disable-next-line no-await-in-loop
          await db
            .delete(equipmentItems)
            .where(
              and(
                eq(equipmentItems.userId, userId),
                eq(equipmentItems.nameKey, nameKey(name)),
              ),
            )
            .run();
        }
        return getEquipment();
      },
      clear: async () => {
        await db
          .delete(equipmentItems)
          .where(eq(equipmentItems.userId, userId))
          .run();
      },
    },
    shoppingList: {
      create: async ({ name, items }) => {
        const id = `list_${crypto.randomUUID().replaceAll("-", "")}`;
        const createdAt = new Date().toISOString();
        const storedItems = newListItems(items);
        await db
          .insert(shoppingLists)
          .values({
            id,
            userId,
            name,
            items: storedItems,
            createdAt,
            updatedAt: createdAt,
          })
          .run();
        return { id, name, items: storedItems, createdAt };
      },
      get: async (listId) => {
        const row = await getListRow(listId);
        return row ? listFromRow(row) : null;
      },
      list: async () => {
        const rows = await db
          .select()
          .from(shoppingLists)
          .where(eq(shoppingLists.userId, userId))
          .orderBy(desc(shoppingLists.updatedAt))
          .all();
        return rows.map((row) => ({
          id: row.id,
          name: row.name,
          itemCount: row.items.length,
          updatedAt: row.updatedAt,
        }));
      },
      addItems: (listId, items) =>
        mutateList(listId, (current) => {
          const added = newListItems(items);
          return { items: [...current, ...added], result: added };
        }),
      updateItem: (listId, itemId, patch: ShoppingListItemPatch) =>
        mutateList(listId, (items) => {
          const index = items.findIndex((item) => item.id === itemId);
          if (index < 0)
            throw new AppErrorException(
              notFoundError(`No list item ${itemId}.`),
            );
          const updated = { ...items[index], ...patch };
          return {
            items: items.map((item, position) =>
              position === index ? updated : item,
            ),
            result: updated,
          };
        }),
      removeItem: (listId, itemId) =>
        mutateList(listId, (items) => {
          if (!items.some((item) => item.id === itemId))
            throw new AppErrorException(
              notFoundError(`No list item ${itemId}.`),
            );
          return {
            items: items.filter((item) => item.id !== itemId),
            result: undefined,
          };
        }),
    },
    orderHistory: {
      getAll: () => getOrders(50),
      getRecent: (limit = 10) => getOrders(limit),
      add: async (order) => {
        await db
          .insert(orderHistory)
          .values({
            id: order.orderId,
            userId,
            record: order,
            placedAt: order.placedAt,
          })
          .run();
        return order;
      },
    },
  };
}

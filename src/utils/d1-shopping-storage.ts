import { and, desc, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";

import type {
  EquipmentItem,
  OrderRecord,
  PantryItem,
  ShoppingList,
  ShoppingListItemPatch,
} from "../domain/shopping.js";
import type { InventoryChanges, ShoppingStore } from "./shopping-store.js";

import {
  equipmentItems,
  orderHistory,
  pantryItems,
  preferredStores,
  shoppingLists,
} from "../db/schema.js";
import { applyListEdit, newListItems, type ListEdit } from "../domain/list-edit.js";

import { AppErrorException, notFoundError, storageError } from "../errors.js";

type NonEmptyBatch = [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

function toPantryItems(rows: (typeof pantryItems.$inferSelect)[]) {
  return rows.map((row) => {
    const item: PantryItem = {
      productName: row.productName,
      quantity: row.quantity,
      addedAt: row.addedAt,
    };

    if (row.expiresAt !== null) {
      item.expiresAt = row.expiresAt;
    }

    return item;
  });
}

function toEquipmentItems(rows: (typeof equipmentItems.$inferSelect)[]) {
  return rows.map((row) => {
    const item: EquipmentItem = {
      equipmentName: row.equipmentName,
      addedAt: row.addedAt,
    };

    if (row.category !== null) {
      item.category = row.category;
    }

    return item;
  });
}

function listFromRow(row: typeof shoppingLists.$inferSelect): ShoppingList {
  const list: ShoppingList = {
    id: row.id,
    name: row.name,
    items: row.items,
    createdAt: row.createdAt,
  };

  if (row.fulfillment) {
    list.fulfillment = row.fulfillment;
  }

  return list;
}

/** D1-backed shopping records for one authenticated Kroger shopper. */
export function createD1ShoppingStore(binding: D1Database, userId: string): ShoppingStore {
  const db = drizzle(binding);

  const selectPantry = () => db.select().from(pantryItems).where(eq(pantryItems.userId, userId));

  const getPantry = async () => toPantryItems(await selectPantry().all());

  const selectEquipment = () =>
    db.select().from(equipmentItems).where(eq(equipmentItems.userId, userId));

  const getEquipment = async () => toEquipmentItems(await selectEquipment().all());

  /**
   * Applies writes and reads the result back in one D1 batch. D1 runs a batch
   * as a single transaction in order, so a failure leaves nothing half-written
   * and duplicate names still merge in request order.
   */
  const writeThenRead = async <TRow>(
    writes: BatchItem<"sqlite">[],
    read: BatchItem<"sqlite"> & PromiseLike<TRow[]>,
  ): Promise<TRow[]> => {
    const statements: BatchItem<"sqlite">[] = [...writes, read];

    // SAFETY: read is always appended, so this tuple has at least one statement.
    const results = await db.batch(statements as NonEmptyBatch);

    // SAFETY: D1 returns batch results in statement order; the final statement is the typed read query above.
    return results.at(-1) as TRow[];
  };

  const addPantry = (entries: InventoryChanges["addPantry"]) =>
    entries.map((item) =>
      db
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
        }),
    );

  const consumePantry = (items: InventoryChanges["consumePantry"]) =>
    items.flatMap((item): BatchItem<"sqlite">[] => {
      const owned = and(
        eq(pantryItems.userId, userId),
        eq(pantryItems.nameKey, nameKey(item.name)),
      );

      if (item.quantity === undefined) {
        return [db.delete(pantryItems).where(owned)];
      }

      return [
        db
          .update(pantryItems)
          .set({ quantity: sql`${pantryItems.quantity} - ${item.quantity}` })
          .where(owned),
        db.delete(pantryItems).where(and(owned, sql`${pantryItems.quantity} <= 0`)),
      ];
    });

  const addEquipment = (entries: InventoryChanges["addEquipment"]) =>
    entries.map((item) =>
      db
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
        }),
    );

  const removeEquipment = (entries: InventoryChanges["removeEquipment"]) =>
    entries.map((name) =>
      db
        .delete(equipmentItems)
        .where(and(eq(equipmentItems.userId, userId), eq(equipmentItems.nameKey, nameKey(name)))),
    );

  const getListRow = (listId: string) =>
    db
      .select()
      .from(shoppingLists)
      .where(and(eq(shoppingLists.id, listId), eq(shoppingLists.userId, userId)))
      .get();

  const editList = async (listId: string, edit: ListEdit) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      // Each retry must read the version written by the preceding attempt.
      // eslint-disable-next-line no-await-in-loop
      const row = await getListRow(listId);

      if (!row) {
        throw new AppErrorException(notFoundError(`No shopping list ${listId}.`));
      }

      const changed = applyListEdit(listFromRow(row), edit);

      // eslint-disable-next-line no-await-in-loop
      const updated = await db
        .update(shoppingLists)
        .set({
          items: changed.list.items,
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

      if (updated.meta.changes === 1) {
        return changed;
      }
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
    updateInventory: async (changes) => {
      const writes = [
        ...addPantry(changes.addPantry),
        ...consumePantry(changes.consumePantry),
        ...addEquipment(changes.addEquipment),
        ...removeEquipment(changes.removeEquipment),
      ];

      // D1 commits the changes and reads both snapshots in one transaction.
      const statements = [...writes, selectPantry(), selectEquipment()];
      // SAFETY: both snapshot queries are always present.
      const results = await db.batch(statements as NonEmptyBatch);

      // SAFETY: the last two statements select pantry and equipment rows in that order.
      return {
        pantry: toPantryItems(results.at(-2) as (typeof pantryItems.$inferSelect)[]),
        equipment: toEquipmentItems(results.at(-1) as (typeof equipmentItems.$inferSelect)[]),
      };
    },
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
        await db.delete(preferredStores).where(eq(preferredStores.userId, userId)).run();
      },
    },
    pantry: {
      getAll: getPantry,
      add: async (items) => {
        const entries = Array.isArray(items) ? items : [items];

        const writes = addPantry(entries);

        return toPantryItems(await writeThenRead(writes, selectPantry()));
      },
      remove: async (names) => {
        const writes = (Array.isArray(names) ? names : [names]).map((name) =>
          db
            .delete(pantryItems)
            .where(and(eq(pantryItems.userId, userId), eq(pantryItems.nameKey, nameKey(name)))),
        );

        return toPantryItems(await writeThenRead(writes, selectPantry()));
      },
      consume: async (items) => {
        const writes = consumePantry(items);

        return toPantryItems(await writeThenRead(writes, selectPantry()));
      },
      updateQuantity: async (productName, quantity) => {
        await db
          .update(pantryItems)
          .set({ quantity })
          .where(and(eq(pantryItems.userId, userId), eq(pantryItems.nameKey, nameKey(productName))))
          .run();

        return getPantry();
      },
      clear: async () => {
        await db.delete(pantryItems).where(eq(pantryItems.userId, userId)).run();
      },
    },
    equipment: {
      getAll: getEquipment,
      add: async (items) => {
        const entries = Array.isArray(items) ? items : [items];

        const writes = addEquipment(entries);

        return toEquipmentItems(await writeThenRead(writes, selectEquipment()));
      },
      remove: async (names) => {
        const writes = removeEquipment(Array.isArray(names) ? names : [names]);

        return toEquipmentItems(await writeThenRead(writes, selectEquipment()));
      },
      clear: async () => {
        await db.delete(equipmentItems).where(eq(equipmentItems.userId, userId)).run();
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
        return db
          .select({
            id: shoppingLists.id,
            name: shoppingLists.name,
            itemCount: sql<number>`json_array_length(${shoppingLists.items})`,
            updatedAt: shoppingLists.updatedAt,
          })
          .from(shoppingLists)
          .where(eq(shoppingLists.userId, userId))
          .orderBy(desc(shoppingLists.updatedAt))
          .all();
      },
      edit: editList,
      addItems: async (listId, add) => (await editList(listId, { add })).added,
      updateItem: async (listId, itemId, patch: ShoppingListItemPatch) =>
        (await editList(listId, { change: [{ itemId, ...patch }] })).changed[0],
      removeItem: async (listId, itemId) => {
        await editList(listId, { remove: [itemId] });
      },
      delete: async (listId) => {
        const deleted = await db
          .delete(shoppingLists)
          .where(and(eq(shoppingLists.id, listId), eq(shoppingLists.userId, userId)))
          .returning({ id: shoppingLists.id, name: shoppingLists.name })
          .get();

        return deleted ?? null;
      },
    },
    orderHistory: {
      getAll: () => getOrders(50),
      getRecent: (limit = 10) => getOrders(limit),
      add: async (order) => {
        const inserted = await db
          .insert(orderHistory)
          .values({
            id: order.orderId,
            userId,
            record: order,
            placedAt: order.placedAt,
          })
          .onConflictDoNothing()
          .returning({ id: orderHistory.id })
          .all();

        if (inserted.length > 0) {
          return { record: order, created: true };
        }

        const [existing] = await db
          .select({ record: orderHistory.record })
          .from(orderHistory)
          .where(and(eq(orderHistory.userId, userId), eq(orderHistory.id, order.orderId)))
          .all();

        if (!existing) {
          throw new Error(`Order ${order.orderId} conflicted but could not be read`);
        }

        return { record: existing.record, created: false };
      },
    },
  };
}

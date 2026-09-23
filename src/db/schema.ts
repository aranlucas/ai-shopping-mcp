import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import type {
  OrderRecord,
  StoredShoppingListItem,
} from "../domain/shopping.js";

export const preferredStores = sqliteTable("preferred_stores", {
  userId: text("user_id").primaryKey(),
  locationId: text("location_id").notNull(),
  locationName: text("location_name").notNull(),
  address: text("address").notNull(),
  chain: text("chain").notNull(),
  setAt: text("set_at").notNull(),
});

export const pantryItems = sqliteTable(
  "pantry_items",
  {
    userId: text("user_id").notNull(),
    nameKey: text("name_key").notNull(),
    productName: text("product_name").notNull(),
    quantity: real("quantity").notNull(),
    addedAt: text("added_at").notNull(),
    expiresAt: text("expires_at"),
  },
  (table) => [primaryKey({ columns: [table.userId, table.nameKey] })],
);

export const equipmentItems = sqliteTable(
  "equipment_items",
  {
    userId: text("user_id").notNull(),
    nameKey: text("name_key").notNull(),
    equipmentName: text("equipment_name").notNull(),
    category: text("category"),
    addedAt: text("added_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.nameKey] })],
);

export const shoppingLists = sqliteTable(
  "shopping_lists",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    items: text("items_json", { mode: "json" })
      .$type<StoredShoppingListItem[]>()
      .notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    index("shopping_lists_user_updated").on(table.userId, table.updatedAt),
  ],
);

export const orderHistory = sqliteTable(
  "order_history",
  {
    id: text("id").notNull(),
    userId: text("user_id").notNull(),
    record: text("record_json", { mode: "json" })
      .$type<OrderRecord>()
      .notNull(),
    placedAt: text("placed_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index("order_history_user_placed").on(table.userId, table.placedAt),
  ],
);

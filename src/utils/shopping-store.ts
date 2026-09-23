import type {
  EquipmentItem,
  OrderRecord,
  PantryItem,
  PreferredLocation,
  ShoppingList,
  ShoppingListItem,
  ShoppingListItemPatch,
  ShoppingListSummary,
  StoredShoppingListItem,
} from "../domain/shopping.js";

/** Durable preferred-store data scoped to one verified Kroger shopper. */
export interface PreferredLocationStore {
  get(): Promise<PreferredLocation | null>;
  set(location: PreferredLocation): Promise<void>;
  delete(): Promise<void>;
}

/** Durable pantry data scoped to one verified Kroger shopper. */
export interface PantryStore {
  getAll(): Promise<PantryItem[]>;
  add(items: PantryItem | PantryItem[]): Promise<PantryItem[]>;
  remove(names: string | string[]): Promise<PantryItem[]>;
  updateQuantity(productName: string, quantity: number): Promise<PantryItem[]>;
  clear(): Promise<void>;
}

/** Durable kitchen-equipment data scoped to one verified Kroger shopper. */
export interface EquipmentStore {
  getAll(): Promise<EquipmentItem[]>;
  add(items: EquipmentItem | EquipmentItem[]): Promise<EquipmentItem[]>;
  remove(names: string | string[]): Promise<EquipmentItem[]>;
  clear(): Promise<void>;
}

/** Durable named shopping-list data scoped to one verified Kroger shopper. */
export interface ShoppingListStore {
  create(input: {
    name: string;
    items: ShoppingListItem[];
  }): Promise<ShoppingList>;
  get(listId: string): Promise<ShoppingList | null>;
  list(): Promise<ShoppingListSummary[]>;
  addItems(
    listId: string,
    items: ShoppingListItem[],
  ): Promise<StoredShoppingListItem[]>;
  updateItem(
    listId: string,
    itemId: string,
    patch: ShoppingListItemPatch,
  ): Promise<StoredShoppingListItem>;
  removeItem(listId: string, itemId: string): Promise<void>;
}

/** Durable completed-order history scoped to one verified Kroger shopper. */
export interface OrderHistoryStore {
  getAll(): Promise<OrderRecord[]>;
  add(order: OrderRecord): Promise<OrderRecord>;
  getRecent(limit?: number): Promise<OrderRecord[]>;
}

/** Durable shopping data scoped to one verified Kroger shopper. */
export interface ShoppingStore {
  preferredLocation: PreferredLocationStore;
  pantry: PantryStore;
  equipment: EquipmentStore;
  orderHistory: OrderHistoryStore;
  shoppingList: ShoppingListStore;
}

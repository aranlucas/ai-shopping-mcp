/**
 * User data storage utilities using Cloudflare KV
 * Manages persistent user data including preferred location, pantry items, and order history
 */

// Type definitions for stored user data
export interface PantryItem {
  productId: string;
  productName: string;
  quantity: number;
  addedAt: string; // ISO timestamp
  expiresAt?: string; // Optional expiry date
}

export interface OrderRecord {
  orderId: string; // Auto-generated
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
    price?: number;
  }>;
  totalItems: number;
  estimatedTotal?: number;
  placedAt: string; // ISO timestamp
  locationId?: string;
  notes?: string;
}

export interface PreferredLocation {
  locationId: string;
  locationName: string;
  address: string;
  chain: string;
  setAt: string; // ISO timestamp
}

export interface EquipmentItem {
  equipmentName: string;
  category?: string; // Optional category (e.g., "Baking", "Cooking", "Utensils")
  addedAt: string; // ISO timestamp
}

export interface ShoppingListItem {
  productId?: string; // Optional - may not have UPC yet
  productName: string;
  quantity: number;
  notes?: string;
  addedAt: string; // ISO timestamp
}

export interface ShoppingList {
  name: string;
  items: ShoppingListItem[];
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

/**
 * Storage keys are namespaced by user ID for data isolation
 */
const getKey = (userId: string, dataType: string): string => {
  return `user:${userId}:${dataType}`;
};

/**
 * Preferred Location Storage
 */
export class PreferredLocationStorage {
  constructor(private kv: KVNamespace) {}

  async set(userId: string, location: PreferredLocation): Promise<void> {
    const key = getKey(userId, "preferred_location");
    await this.kv.put(key, JSON.stringify(location));
  }

  async get(userId: string): Promise<PreferredLocation | null> {
    const key = getKey(userId, "preferred_location");
    const value = await this.kv.get(key);
    if (!value) return null;
    return JSON.parse(value) as PreferredLocation;
  }

  async delete(userId: string): Promise<void> {
    const key = getKey(userId, "preferred_location");
    await this.kv.delete(key);
  }
}

/**
 * Pantry Storage - manages items the user has at home
 */
export class PantryStorage {
  constructor(private kv: KVNamespace) {}

  async getAll(userId: string): Promise<PantryItem[]> {
    const key = getKey(userId, "pantry");
    const value = await this.kv.get(key);
    if (!value) return [];
    return JSON.parse(value) as PantryItem[];
  }

  async add(userId: string, item: PantryItem): Promise<PantryItem[]> {
    const pantry = await this.getAll(userId);

    // Check if item already exists and update quantity
    const existingIndex = pantry.findIndex(
      (p: PantryItem) => p.productId === item.productId,
    );

    if (existingIndex >= 0) {
      pantry[existingIndex].quantity += item.quantity;
      pantry[existingIndex].addedAt = item.addedAt;
    } else {
      pantry.push(item);
    }

    const key = getKey(userId, "pantry");
    await this.kv.put(key, JSON.stringify(pantry));
    return pantry;
  }

  async remove(userId: string, productId: string): Promise<PantryItem[]> {
    const pantry = await this.getAll(userId);
    const filtered = pantry.filter(
      (item: PantryItem) => item.productId !== productId,
    );

    const key = getKey(userId, "pantry");
    await this.kv.put(key, JSON.stringify(filtered));
    return filtered;
  }

  async updateQuantity(
    userId: string,
    productId: string,
    quantity: number,
  ): Promise<PantryItem[]> {
    const pantry = await this.getAll(userId);
    const item = pantry.find((p: PantryItem) => p.productId === productId);

    if (item) {
      item.quantity = quantity;
      const key = getKey(userId, "pantry");
      await this.kv.put(key, JSON.stringify(pantry));
    }

    return pantry;
  }

  async clear(userId: string): Promise<void> {
    const key = getKey(userId, "pantry");
    await this.kv.delete(key);
  }
}

/**
 * Equipment Storage - manages kitchen equipment and tools the user owns
 */
export class EquipmentStorage {
  constructor(private kv: KVNamespace) {}

  async getAll(userId: string): Promise<EquipmentItem[]> {
    const key = getKey(userId, "equipment");
    const value = await this.kv.get(key);
    if (!value) return [];
    return JSON.parse(value) as EquipmentItem[];
  }

  async add(userId: string, item: EquipmentItem): Promise<EquipmentItem[]> {
    const equipment = await this.getAll(userId);

    // Check if item already exists by name (case-insensitive)
    const existingIndex = equipment.findIndex(
      (e: EquipmentItem) =>
        e.equipmentName.toLowerCase() === item.equipmentName.toLowerCase(),
    );

    if (existingIndex >= 0) {
      // Update existing equipment item
      equipment[existingIndex].category =
        item.category || equipment[existingIndex].category;
      equipment[existingIndex].addedAt = item.addedAt;
    } else {
      equipment.push(item);
    }

    const key = getKey(userId, "equipment");
    await this.kv.put(key, JSON.stringify(equipment));
    return equipment;
  }

  async remove(
    userId: string,
    equipmentName: string,
  ): Promise<EquipmentItem[]> {
    const equipment = await this.getAll(userId);
    const filtered = equipment.filter(
      (item: EquipmentItem) =>
        item.equipmentName.toLowerCase() !== equipmentName.toLowerCase(),
    );

    const key = getKey(userId, "equipment");
    await this.kv.put(key, JSON.stringify(filtered));
    return filtered;
  }

  async clear(userId: string): Promise<void> {
    const key = getKey(userId, "equipment");
    await this.kv.delete(key);
  }
}

/**
 * Order History Storage - tracks past orders
 */
export class OrderHistoryStorage {
  constructor(private kv: KVNamespace) {}

  async getAll(userId: string): Promise<OrderRecord[]> {
    const key = getKey(userId, "order_history");
    const value = await this.kv.get(key);
    if (!value) return [];
    return JSON.parse(value) as OrderRecord[];
  }

  async add(userId: string, order: OrderRecord): Promise<OrderRecord[]> {
    const history = await this.getAll(userId);
    history.unshift(order); // Add to beginning (most recent first)

    // Keep only last 50 orders to avoid unlimited growth
    const trimmedHistory = history.slice(0, 50);

    const key = getKey(userId, "order_history");
    await this.kv.put(key, JSON.stringify(trimmedHistory));
    return trimmedHistory;
  }

  async getRecent(userId: string, limit = 10): Promise<OrderRecord[]> {
    const history = await this.getAll(userId);
    return history.slice(0, limit);
  }

  async clear(userId: string): Promise<void> {
    const key = getKey(userId, "order_history");
    await this.kv.delete(key);
  }
}

/**
 * Shopping List Storage - manages named shopping lists
 */
export class ShoppingListStorage {
  constructor(private kv: KVNamespace) {}

  async getAll(userId: string): Promise<ShoppingList[]> {
    const key = getKey(userId, "shopping_lists");
    const value = await this.kv.get(key);
    if (!value) return [];
    return JSON.parse(value) as ShoppingList[];
  }

  async get(userId: string, listName: string): Promise<ShoppingList | null> {
    const lists = await this.getAll(userId);
    return (
      lists.find(
        (list: ShoppingList) =>
          list.name.toLowerCase() === listName.toLowerCase(),
      ) || null
    );
  }

  async create(
    userId: string,
    listName: string,
    items: ShoppingListItem[] = [],
  ): Promise<ShoppingList> {
    const lists = await this.getAll(userId);

    // Check if list already exists (case-insensitive)
    const existingIndex = lists.findIndex(
      (list: ShoppingList) =>
        list.name.toLowerCase() === listName.toLowerCase(),
    );

    if (existingIndex >= 0) {
      throw new Error(`Shopping list "${listName}" already exists`);
    }

    const now = new Date().toISOString();
    const newList: ShoppingList = {
      name: listName,
      items: items,
      createdAt: now,
      updatedAt: now,
    };

    lists.push(newList);

    const key = getKey(userId, "shopping_lists");
    await this.kv.put(key, JSON.stringify(lists));

    return newList;
  }

  async delete(userId: string, listName: string): Promise<ShoppingList[]> {
    const lists = await this.getAll(userId);
    const filtered = lists.filter(
      (list: ShoppingList) =>
        list.name.toLowerCase() !== listName.toLowerCase(),
    );

    const key = getKey(userId, "shopping_lists");
    await this.kv.put(key, JSON.stringify(filtered));
    return filtered;
  }

  async addItems(
    userId: string,
    listName: string,
    newItems: ShoppingListItem[],
  ): Promise<ShoppingList> {
    const lists = await this.getAll(userId);
    const listIndex = lists.findIndex(
      (list: ShoppingList) =>
        list.name.toLowerCase() === listName.toLowerCase(),
    );

    if (listIndex < 0) {
      throw new Error(`Shopping list "${listName}" not found`);
    }

    const list = lists[listIndex];

    // Add new items to the list
    for (const newItem of newItems) {
      // Check if item with same productId already exists
      if (newItem.productId) {
        const existingItemIndex = list.items.findIndex(
          (item: ShoppingListItem) => item.productId === newItem.productId,
        );

        if (existingItemIndex >= 0) {
          // Update quantity if item exists
          list.items[existingItemIndex].quantity += newItem.quantity;
          list.items[existingItemIndex].addedAt = newItem.addedAt;
        } else {
          list.items.push(newItem);
        }
      } else {
        // No productId, just add the item
        list.items.push(newItem);
      }
    }

    list.updatedAt = new Date().toISOString();
    lists[listIndex] = list;

    const key = getKey(userId, "shopping_lists");
    await this.kv.put(key, JSON.stringify(lists));

    return list;
  }

  async removeItems(
    userId: string,
    listName: string,
    productIds: string[],
  ): Promise<ShoppingList> {
    const lists = await this.getAll(userId);
    const listIndex = lists.findIndex(
      (list: ShoppingList) =>
        list.name.toLowerCase() === listName.toLowerCase(),
    );

    if (listIndex < 0) {
      throw new Error(`Shopping list "${listName}" not found`);
    }

    const list = lists[listIndex];
    list.items = list.items.filter(
      (item: ShoppingListItem) => !productIds.includes(item.productId || ""),
    );
    list.updatedAt = new Date().toISOString();

    lists[listIndex] = list;

    const key = getKey(userId, "shopping_lists");
    await this.kv.put(key, JSON.stringify(lists));

    return list;
  }

  async clearList(userId: string, listName: string): Promise<ShoppingList> {
    const lists = await this.getAll(userId);
    const listIndex = lists.findIndex(
      (list: ShoppingList) =>
        list.name.toLowerCase() === listName.toLowerCase(),
    );

    if (listIndex < 0) {
      throw new Error(`Shopping list "${listName}" not found`);
    }

    const list = lists[listIndex];
    list.items = [];
    list.updatedAt = new Date().toISOString();

    lists[listIndex] = list;

    const key = getKey(userId, "shopping_lists");
    await this.kv.put(key, JSON.stringify(lists));

    return list;
  }

  async clearAll(userId: string): Promise<void> {
    const key = getKey(userId, "shopping_lists");
    await this.kv.delete(key);
  }
}

/**
 * Factory function to create storage instances
 */
export function createUserStorage(kv: KVNamespace) {
  return {
    preferredLocation: new PreferredLocationStorage(kv),
    pantry: new PantryStorage(kv),
    equipment: new EquipmentStorage(kv),
    orderHistory: new OrderHistoryStorage(kv),
    shoppingLists: new ShoppingListStorage(kv),
  };
}

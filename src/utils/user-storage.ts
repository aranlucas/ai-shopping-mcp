/**
 * User data storage utilities using Cloudflare KV
 * Manages persistent user data including preferred location, pantry items, and order history
 */

// Type definitions for stored user data
export interface PantryItem {
  productName: string; // Primary identifier (case-insensitive)
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
  productName: string; // Display name (e.g., "Whole Milk")
  upc?: string; // 13-digit UPC for adding to Kroger cart
  quantity: number;
  notes?: string; // Optional notes (e.g., "get organic if available")
  addedAt: string; // ISO timestamp
  checked: boolean; // Whether item has been checked off / added to cart
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

    // Check if item already exists by name (case-insensitive) and update quantity
    const existingIndex = pantry.findIndex(
      (p: PantryItem) => p.productName.toLowerCase() === item.productName.toLowerCase(),
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

  async remove(userId: string, productName: string): Promise<PantryItem[]> {
    const pantry = await this.getAll(userId);
    const filtered = pantry.filter(
      (item: PantryItem) => item.productName.toLowerCase() !== productName.toLowerCase(),
    );

    const key = getKey(userId, "pantry");
    await this.kv.put(key, JSON.stringify(filtered));
    return filtered;
  }

  async updateQuantity(
    userId: string,
    productName: string,
    quantity: number,
  ): Promise<PantryItem[]> {
    const pantry = await this.getAll(userId);
    const item = pantry.find(
      (p: PantryItem) => p.productName.toLowerCase() === productName.toLowerCase(),
    );

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
      (e: EquipmentItem) => e.equipmentName.toLowerCase() === item.equipmentName.toLowerCase(),
    );

    if (existingIndex >= 0) {
      // Update existing equipment item
      equipment[existingIndex].category = item.category || equipment[existingIndex].category;
      equipment[existingIndex].addedAt = item.addedAt;
    } else {
      equipment.push(item);
    }

    const key = getKey(userId, "equipment");
    await this.kv.put(key, JSON.stringify(equipment));
    return equipment;
  }

  async remove(userId: string, equipmentName: string): Promise<EquipmentItem[]> {
    const equipment = await this.getAll(userId);
    const filtered = equipment.filter(
      (item: EquipmentItem) => item.equipmentName.toLowerCase() !== equipmentName.toLowerCase(),
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
 * Shopping List Storage - manages items the user plans to buy
 */
export class ShoppingListStorage {
  constructor(private kv: KVNamespace) {}

  async getAll(userId: string): Promise<ShoppingListItem[]> {
    const key = getKey(userId, "shopping_list");
    const value = await this.kv.get(key);
    if (!value) return [];
    return JSON.parse(value) as ShoppingListItem[];
  }

  async add(userId: string, item: ShoppingListItem): Promise<ShoppingListItem[]> {
    const list = await this.getAll(userId);

    // Check if item already exists by name (case-insensitive) and update quantity
    const existingIndex = list.findIndex(
      (i: ShoppingListItem) => i.productName.toLowerCase() === item.productName.toLowerCase(),
    );

    if (existingIndex >= 0) {
      list[existingIndex].quantity += item.quantity;
      list[existingIndex].addedAt = item.addedAt;
      // Update UPC if provided and not already set
      if (item.upc) {
        list[existingIndex].upc = item.upc;
      }
      // Update notes if provided
      if (item.notes) {
        list[existingIndex].notes = item.notes;
      }
    } else {
      list.push(item);
    }

    const key = getKey(userId, "shopping_list");
    await this.kv.put(key, JSON.stringify(list));
    return list;
  }

  async remove(userId: string, productName: string): Promise<ShoppingListItem[]> {
    const list = await this.getAll(userId);
    const filtered = list.filter(
      (item: ShoppingListItem) => item.productName.toLowerCase() !== productName.toLowerCase(),
    );

    const key = getKey(userId, "shopping_list");
    await this.kv.put(key, JSON.stringify(filtered));
    return filtered;
  }

  async updateItem(
    userId: string,
    productName: string,
    updates: Partial<Pick<ShoppingListItem, "quantity" | "upc" | "notes" | "checked">>,
  ): Promise<ShoppingListItem[]> {
    const list = await this.getAll(userId);
    const item = list.find(
      (i: ShoppingListItem) => i.productName.toLowerCase() === productName.toLowerCase(),
    );

    if (item) {
      if (updates.quantity !== undefined) item.quantity = updates.quantity;
      if (updates.upc !== undefined) item.upc = updates.upc;
      if (updates.notes !== undefined) item.notes = updates.notes;
      if (updates.checked !== undefined) item.checked = updates.checked;

      const key = getKey(userId, "shopping_list");
      await this.kv.put(key, JSON.stringify(list));
    }

    return list;
  }

  async getUnchecked(userId: string): Promise<ShoppingListItem[]> {
    const list = await this.getAll(userId);
    return list.filter((item: ShoppingListItem) => !item.checked);
  }

  async markAllChecked(userId: string): Promise<ShoppingListItem[]> {
    const list = await this.getAll(userId);
    for (const item of list) {
      item.checked = true;
    }
    const key = getKey(userId, "shopping_list");
    await this.kv.put(key, JSON.stringify(list));
    return list;
  }

  async clear(userId: string): Promise<void> {
    const key = getKey(userId, "shopping_list");
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
 * Factory function to create storage instances
 */
export function createUserStorage(kv: KVNamespace) {
  return {
    preferredLocation: new PreferredLocationStorage(kv),
    pantry: new PantryStorage(kv),
    equipment: new EquipmentStorage(kv),
    orderHistory: new OrderHistoryStorage(kv),
    shoppingList: new ShoppingListStorage(kv),
  };
}

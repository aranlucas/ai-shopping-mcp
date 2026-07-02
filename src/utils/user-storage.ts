/**
 * User data storage utilities using Cloudflare KV
 * Manages persistent user data including preferred location, pantry items, and order history
 */
import * as z from "zod/v4";

import { safeJsonParseWithSchema } from "./json.js";

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
}

/**
 * A shopping list is an immutable snapshot created by `create_shopping_list`.
 * The storage `id` is a namespaced key built from the authenticated user id,
 * session id, and a short `listId` (e.g. `list_a1b2c3d8`) shown to the agent.
 * Lists are never mutated in place — refining the list means creating a new one.
 */
export interface ShoppingList {
  id: string;
  name: string;
  items: ShoppingListItem[];
  createdAt: string; // ISO timestamp
}

const pantryItemSchema = z.looseObject({
  productName: z.string(),
  quantity: z.number(),
  addedAt: z.string(),
  expiresAt: z.string().optional(),
});

const orderRecordSchema = z.looseObject({
  orderId: z.string(),
  items: z.array(
    z.looseObject({
      productId: z.string(),
      productName: z.string(),
      quantity: z.number(),
      price: z.number().optional(),
    }),
  ),
  totalItems: z.number(),
  estimatedTotal: z.number().optional(),
  placedAt: z.string(),
  locationId: z.string().optional(),
  notes: z.string().optional(),
});

const preferredLocationSchema = z.looseObject({
  locationId: z.string(),
  locationName: z.string(),
  address: z.string(),
  chain: z.string(),
  setAt: z.string(),
});

const equipmentItemSchema = z.looseObject({
  equipmentName: z.string(),
  category: z.string().optional(),
  addedAt: z.string(),
});

const shoppingListItemSchema = z.looseObject({
  productName: z.string(),
  upc: z.string().optional(),
  quantity: z.number(),
  notes: z.string().optional(),
});

const shoppingListSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  items: z.array(shoppingListItemSchema),
  createdAt: z.string(),
});

/**
 * Storage keys are namespaced by user ID for data isolation
 */
const getKey = (userId: string, dataType: string): string => {
  return `user:${userId}:${dataType}`;
};

/**
 * Parse a JSON string read from KV, returning `fallback` if the value is
 * missing or malformed. KV entries can be hand-edited or left over from an
 * older shape, so a corrupted entry should degrade to the default rather than
 * throw and break the whole read.
 */
function parseJson<TSchema extends z.ZodType>(
  value: string | null,
  schema: TSchema,
  fallback: z.output<TSchema>,
): z.output<TSchema> {
  if (value == null) return fallback;
  const result = safeJsonParseWithSchema(value, schema);
  return result.match(
    (parsed) => parsed,
    (error) => {
      console.warn("Discarding corrupted KV entry:", error);
      return fallback;
    },
  );
}

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
    return parseJson(value, preferredLocationSchema.nullable(), null);
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
    return parseJson(value, z.array(pantryItemSchema), []);
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
    return parseJson(value, z.array(equipmentItemSchema), []);
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
 * Shopping List Storage - persists named, id-keyed shopping lists created by
 * `create_shopping_list`. Lists are immutable snapshots: the agent creates a
 * fresh list to refine, never mutates an existing one. `add_shopping_list_to_cart`
 * reads a list back by id to send its items to the Kroger cart.
 *
 * Entries auto-expire from KV after `LIST_TTL_SECONDS` (7 days) so dead lists
 * from abandoned conversations don't accumulate.
 */
const SHOPPING_LIST_KEY = (id: string) => `shopping_list:${id}`;
const LIST_TTL_SECONDS = 60 * 60 * 24 * 7;

export class ShoppingListStorage {
  constructor(private kv: KVNamespace) {}

  /**
   * Create and persist a new shopping list under the supplied id. The caller
   * (the create tool) is responsible for namespacing the id with the user id
   * and session so a later `add_shopping_list_to_cart` can read it back safely.
   */
  async create(id: string, name: string, items: ShoppingListItem[]): Promise<ShoppingList> {
    const list: ShoppingList = {
      id,
      name,
      items,
      createdAt: new Date().toISOString(),
    };
    await this.kv.put(SHOPPING_LIST_KEY(id), JSON.stringify(list), {
      expirationTtl: LIST_TTL_SECONDS,
    });
    return list;
  }

  async get(id: string): Promise<ShoppingList | null> {
    const value = await this.kv.get(SHOPPING_LIST_KEY(id));
    return parseJson(value, shoppingListSchema.nullable(), null);
  }

  async clear(id: string): Promise<void> {
    await this.kv.delete(SHOPPING_LIST_KEY(id));
  }
}

/**
 * Cart Snapshot Storage - persists the Kroger cart contents that resulted
 * from adding a shopping list to the user's cart, keyed by the shopping
 * list's namespaced storage id. This mapping also lets `add_shopping_list_to_cart`
 * detect a retried call for the same list and short-circuit instead of
 * re-adding the same items.
 *
 * Entries auto-expire from KV after `SNAPSHOT_TTL_SECONDS` (7 days) alongside
 * the shopping list itself.
 */
const SNAPSHOT_TTL_SECONDS = 60 * 60 * 24 * 7;

export type CartSnapshotItem = {
  upc: string;
  quantity: number;
  modality: "PICKUP" | "DELIVERY";
  productName?: string;
};

const cartSnapshotItemSchema = z.looseObject({
  upc: z.string(),
  quantity: z.number(),
  modality: z.enum(["PICKUP", "DELIVERY"]),
  productName: z.string().optional(),
});

export class CartSnapshotStorage {
  constructor(private kv: KVNamespace) {}

  async get(shoppingListId: string): Promise<CartSnapshotItem[] | null> {
    const key = getKey(shoppingListId, "cart_snapshot");
    const value = await this.kv.get(key);
    return parseJson(value, z.array(cartSnapshotItemSchema).nullable(), null);
  }

  async set(shoppingListId: string, items: CartSnapshotItem[]): Promise<void> {
    const key = getKey(shoppingListId, "cart_snapshot");
    await this.kv.put(key, JSON.stringify(items), {
      expirationTtl: SNAPSHOT_TTL_SECONDS,
    });
  }

  async clear(shoppingListId: string): Promise<void> {
    const key = getKey(shoppingListId, "cart_snapshot");
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
    return parseJson(value, z.array(orderRecordSchema), []);
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
    cartSnapshot: new CartSnapshotStorage(kv),
  };
}

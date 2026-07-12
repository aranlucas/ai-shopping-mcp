/** Identity-bound Cloudflare KV persistence for shopping-domain state. */
import * as z from "zod/v4";

import type { PersistenceKv } from "./kv.js";

import { safeJsonParseWithSchema } from "./json.js";

export interface PantryItem {
  productName: string;
  quantity: number;
  addedAt: string;
  expiresAt?: string;
}

export interface OrderRecord {
  orderId: string;
  items: Array<{
    upc: string;
    productName: string;
    quantity: number;
    price?: number;
  }>;
  totalItems: number;
  estimatedTotal?: number;
  placedAt: string;
  locationId?: string;
  notes?: string;
}

export interface PreferredLocation {
  locationId: string;
  locationName: string;
  address: string;
  chain: string;
  setAt: string;
}

export interface EquipmentItem {
  equipmentName: string;
  category?: string;
  addedAt: string;
}

export interface ShoppingListItem {
  productName: string;
  upc?: string;
  quantity: number;
  notes?: string;
}

export interface ShoppingList {
  id: string;
  name: string;
  items: ShoppingListItem[];
  createdAt: string;
}

export type CartSnapshotItem = {
  upc: string;
  quantity: number;
  modality: "PICKUP" | "DELIVERY";
  productName?: string;
};

export type CartMirrorItem = CartSnapshotItem & { addedAt: string };

export type PersistenceIdentity = Readonly<{ userId: string; sessionId: string }>;

const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7;
const ORDER_HISTORY_MAX = 50;
const CART_MIRROR_MAX_ITEMS = 100;

const pantryItemSchema = z.looseObject({
  productName: z.string(),
  quantity: z.number(),
  addedAt: z.string(),
  expiresAt: z.string().optional(),
});
const equipmentItemSchema = z.looseObject({
  equipmentName: z.string(),
  category: z.string().optional(),
  addedAt: z.string(),
});
const preferredLocationSchema = z.looseObject({
  locationId: z.string(),
  locationName: z.string(),
  address: z.string(),
  chain: z.string(),
  setAt: z.string(),
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
const cartSnapshotItemSchema = z.looseObject({
  upc: z.string(),
  quantity: z.number(),
  modality: z.enum(["PICKUP", "DELIVERY"]),
  productName: z.string().optional(),
});
const cartMirrorItemSchema = z.looseObject({
  ...cartSnapshotItemSchema.shape,
  addedAt: z.string(),
});
const orderRecordSchema = z.looseObject({
  orderId: z.string(),
  items: z.array(
    z.looseObject({
      upc: z.string(),
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

/** A corrupt collection must not be treated as empty by a later mutation. */
export class CorruptPersistenceEntryError extends Error {
  readonly cause: unknown;

  constructor(
    readonly key: string,
    cause: unknown,
  ) {
    super(`Stored data at ${key} is corrupt or incompatible`);
    this.cause = cause;
    this.name = "CorruptPersistenceEntryError";
  }
}

function userKey(userId: string, dataType: string): string {
  return `user:${userId}:${dataType}`;
}

function listIdentity({ userId, sessionId }: PersistenceIdentity, listId: string): string {
  return `${userId}:session:${sessionId}:list:${listId}`;
}

function listKey(identity: PersistenceIdentity, listId: string): string {
  return `shopping_list:${listIdentity(identity, listId)}`;
}

function cartReceiptKey(identity: PersistenceIdentity, listId: string): string {
  return userKey(listIdentity(identity, listId), "cart_snapshot");
}

function decode<TSchema extends z.ZodType>(key: string, value: string, schema: TSchema) {
  const result = safeJsonParseWithSchema(value, schema);
  return result.match(
    (parsed) => parsed,
    (error) => {
      throw new CorruptPersistenceEntryError(key, error);
    },
  );
}

async function readOptional<TSchema extends z.ZodType>(
  kv: PersistenceKv,
  key: string,
  schema: TSchema,
): Promise<z.output<TSchema> | null> {
  const value = await kv.get(key);
  if (value == null) return null;
  return decode(key, value, schema);
}

async function readCollection<TSchema extends z.ZodType>(
  kv: PersistenceKv,
  key: string,
  schema: TSchema,
): Promise<z.output<TSchema>[]> {
  const value = await kv.get(key);
  if (value == null) return [];
  return decode(key, value, z.array(schema));
}

async function readOptionalTolerant<TSchema extends z.ZodType>(
  kv: PersistenceKv,
  key: string,
  schema: TSchema,
): Promise<z.output<TSchema> | null> {
  try {
    return await readOptional(kv, key, schema);
  } catch (error) {
    if (!(error instanceof CorruptPersistenceEntryError)) throw error;
    console.warn("Discarding corrupted KV entry:", error);
    return null;
  }
}

async function readCollectionTolerant<TSchema extends z.ZodType>(
  kv: PersistenceKv,
  key: string,
  schema: TSchema,
): Promise<z.output<TSchema>[]> {
  try {
    return await readCollection(kv, key, schema);
  } catch (error) {
    if (!(error instanceof CorruptPersistenceEntryError)) throw error;
    console.warn("Discarding corrupted KV entry:", error);
    return [];
  }
}

/**
 * Deep persistence module bound to one authenticated user and MCP session.
 * Callers supply domain identifiers only; raw KV keys never cross this boundary.
 * Collection mutations are single read-modify-write operations. KV still offers
 * no transaction or compare-and-swap guarantee, so concurrent writes can race.
 */
export class ShoppingPersistence {
  private readonly getIdentity: () => PersistenceIdentity;

  constructor(
    private readonly kv: PersistenceKv,
    identity: PersistenceIdentity | (() => PersistenceIdentity),
    private readonly now: () => Date = () => new Date(),
  ) {
    this.getIdentity = typeof identity === "function" ? identity : () => identity;
  }

  preferredLocation = {
    get: async (): Promise<PreferredLocation | null> =>
      readOptionalTolerant(
        this.kv,
        userKey(this.getIdentity().userId, "preferred_location"),
        preferredLocationSchema,
      ),
    set: async (location: PreferredLocation): Promise<void> => {
      await this.kv.put(
        userKey(this.getIdentity().userId, "preferred_location"),
        JSON.stringify(location),
      );
    },
    delete: async (): Promise<void> => {
      await this.kv.delete(userKey(this.getIdentity().userId, "preferred_location"));
    },
  };

  pantry = {
    getAll: async (): Promise<PantryItem[]> =>
      readCollectionTolerant(
        this.kv,
        userKey(this.getIdentity().userId, "pantry"),
        pantryItemSchema,
      ),
    add: async (items: PantryItem | PantryItem[]): Promise<PantryItem[]> => {
      const pantry: PantryItem[] = await readCollection(
        this.kv,
        userKey(this.getIdentity().userId, "pantry"),
        pantryItemSchema,
      );
      for (const item of Array.isArray(items) ? items : [items]) {
        const existing = pantry.find(
          (candidate) => candidate.productName.toLowerCase() === item.productName.toLowerCase(),
        );
        if (existing) {
          existing.quantity += item.quantity;
          existing.addedAt = item.addedAt;
        } else {
          pantry.push(item);
        }
      }
      await this.kv.put(userKey(this.getIdentity().userId, "pantry"), JSON.stringify(pantry));
      return pantry;
    },
    remove: async (names: string | string[]): Promise<PantryItem[]> => {
      const pantry: PantryItem[] = await readCollection(
        this.kv,
        userKey(this.getIdentity().userId, "pantry"),
        pantryItemSchema,
      );
      const normalized = new Set(
        (Array.isArray(names) ? names : [names]).map((name) => name.toLowerCase()),
      );
      const filtered = pantry.filter((item) => !normalized.has(item.productName.toLowerCase()));
      await this.kv.put(userKey(this.getIdentity().userId, "pantry"), JSON.stringify(filtered));
      return filtered;
    },
    updateQuantity: async (productName: string, quantity: number): Promise<PantryItem[]> => {
      const pantry: PantryItem[] = await readCollection(
        this.kv,
        userKey(this.getIdentity().userId, "pantry"),
        pantryItemSchema,
      );
      const item = pantry.find(
        (candidate) => candidate.productName.toLowerCase() === productName.toLowerCase(),
      );
      if (item) {
        item.quantity = quantity;
        await this.kv.put(userKey(this.getIdentity().userId, "pantry"), JSON.stringify(pantry));
      }
      return pantry;
    },
    clear: async (): Promise<void> => {
      await this.kv.delete(userKey(this.getIdentity().userId, "pantry"));
    },
  };

  equipment = {
    getAll: async (): Promise<EquipmentItem[]> =>
      readCollectionTolerant(
        this.kv,
        userKey(this.getIdentity().userId, "equipment"),
        equipmentItemSchema,
      ),
    add: async (items: EquipmentItem | EquipmentItem[]): Promise<EquipmentItem[]> => {
      const equipment: EquipmentItem[] = await readCollection(
        this.kv,
        userKey(this.getIdentity().userId, "equipment"),
        equipmentItemSchema,
      );
      for (const item of Array.isArray(items) ? items : [items]) {
        const existing = equipment.find(
          (candidate) => candidate.equipmentName.toLowerCase() === item.equipmentName.toLowerCase(),
        );
        if (existing) {
          existing.category = item.category || existing.category;
          existing.addedAt = item.addedAt;
        } else {
          equipment.push(item);
        }
      }
      await this.kv.put(userKey(this.getIdentity().userId, "equipment"), JSON.stringify(equipment));
      return equipment;
    },
    remove: async (names: string | string[]): Promise<EquipmentItem[]> => {
      const equipment: EquipmentItem[] = await readCollection(
        this.kv,
        userKey(this.getIdentity().userId, "equipment"),
        equipmentItemSchema,
      );
      const normalized = new Set(
        (Array.isArray(names) ? names : [names]).map((name) => name.toLowerCase()),
      );
      const filtered = equipment.filter(
        (item) => !normalized.has(item.equipmentName.toLowerCase()),
      );
      await this.kv.put(userKey(this.getIdentity().userId, "equipment"), JSON.stringify(filtered));
      return filtered;
    },
    clear: async (): Promise<void> => {
      await this.kv.delete(userKey(this.getIdentity().userId, "equipment"));
    },
  };

  shoppingList = {
    create: async (
      listId: string,
      name: string,
      items: ShoppingListItem[],
    ): Promise<ShoppingList> => {
      const identity = this.getIdentity();
      const id = listIdentity(identity, listId);
      const list = { id, name, items, createdAt: this.now().toISOString() };
      await this.kv.put(listKey(identity, listId), JSON.stringify(list), {
        expirationTtl: SEVEN_DAYS_SECONDS,
      });
      return list;
    },
    get: async (listId: string): Promise<ShoppingList | null> =>
      readOptionalTolerant(this.kv, listKey(this.getIdentity(), listId), shoppingListSchema),
    clear: async (listId: string): Promise<void> => {
      await this.kv.delete(listKey(this.getIdentity(), listId));
    },
  };

  cartSnapshot = {
    get: async (listId: string): Promise<CartSnapshotItem[] | null> =>
      readOptional(
        this.kv,
        cartReceiptKey(this.getIdentity(), listId),
        z.array(cartSnapshotItemSchema),
      ),
    set: async (listId: string, items: CartSnapshotItem[]): Promise<void> => {
      await this.kv.put(cartReceiptKey(this.getIdentity(), listId), JSON.stringify(items), {
        expirationTtl: SEVEN_DAYS_SECONDS,
      });
    },
    clear: async (listId: string): Promise<void> => {
      await this.kv.delete(cartReceiptKey(this.getIdentity(), listId));
    },
  };

  cartMirror = {
    getAll: async (): Promise<CartMirrorItem[]> =>
      readCollectionTolerant(
        this.kv,
        userKey(this.getIdentity().userId, "cart_mirror"),
        cartMirrorItemSchema,
      ),
    append: async (items: CartSnapshotItem[], addedAt: string): Promise<CartMirrorItem[]> => {
      const existing = await readCollection(
        this.kv,
        userKey(this.getIdentity().userId, "cart_mirror"),
        cartMirrorItemSchema,
      );
      const merged = [...existing, ...items.map((item) => ({ ...item, addedAt }))].slice(
        -CART_MIRROR_MAX_ITEMS,
      );
      await this.kv.put(userKey(this.getIdentity().userId, "cart_mirror"), JSON.stringify(merged), {
        expirationTtl: SEVEN_DAYS_SECONDS,
      });
      return merged;
    },
    clear: async (): Promise<void> => {
      await this.kv.delete(userKey(this.getIdentity().userId, "cart_mirror"));
    },
  };

  cartId = {
    get: async (): Promise<string | null> =>
      this.kv.get(userKey(this.getIdentity().userId, "kroger-cart-id")),
    set: async (cartId: string): Promise<void> => {
      await this.kv.put(userKey(this.getIdentity().userId, "kroger-cart-id"), cartId);
    },
  };

  orderHistory = {
    getAll: async (): Promise<OrderRecord[]> =>
      readCollectionTolerant(
        this.kv,
        userKey(this.getIdentity().userId, "order_history"),
        orderRecordSchema,
      ),
    add: async (order: OrderRecord): Promise<OrderRecord[]> => {
      const history = await readCollection(
        this.kv,
        userKey(this.getIdentity().userId, "order_history"),
        orderRecordSchema,
      );
      const trimmed = [order, ...history].slice(0, ORDER_HISTORY_MAX);
      await this.kv.put(
        userKey(this.getIdentity().userId, "order_history"),
        JSON.stringify(trimmed),
      );
      return trimmed;
    },
    getRecent: async (limit = 10): Promise<OrderRecord[]> =>
      (await this.orderHistory.getAll()).slice(0, limit),
    clear: async (): Promise<void> => {
      await this.kv.delete(userKey(this.getIdentity().userId, "order_history"));
    },
  };
}

export function createShoppingPersistence(
  kv: PersistenceKv,
  identity: PersistenceIdentity | (() => PersistenceIdentity),
  now?: () => Date,
): ShoppingPersistence {
  return new ShoppingPersistence(kv, identity, now);
}

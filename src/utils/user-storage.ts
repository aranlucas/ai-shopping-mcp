/** Tool-facing shopping domain types plus cart-only Cloudflare KV persistence. */
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

export interface CartStore {
  cartSnapshot: {
    get(listId: string): Promise<CartSnapshotItem[] | null>;
    set(listId: string, items: CartSnapshotItem[]): Promise<void>;
    clear(listId: string): Promise<void>;
  };
  cartMirror: {
    getAll(): Promise<CartMirrorItem[]>;
    append(items: CartSnapshotItem[], addedAt: string): Promise<CartMirrorItem[]>;
    clear(): Promise<void>;
  };
  cartId: {
    get(): Promise<string | null>;
    set(cartId: string): Promise<void>;
  };
}

const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7;
const CART_MIRROR_MAX_ITEMS = 100;

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

/** A corrupt cart entry must not be treated as empty by a later mutation. */
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
 * Cart-only persistence bound to one authenticated user and MCP session.
 * Shopping profile, inventory, lists, and order history live in agents-gateway.
 */
export class CartPersistence implements CartStore {
  private readonly getIdentity: () => PersistenceIdentity;

  constructor(
    private readonly kv: PersistenceKv,
    identity: PersistenceIdentity | (() => PersistenceIdentity),
  ) {
    this.getIdentity = typeof identity === "function" ? identity : () => identity;
  }

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
}

export function createCartPersistence(
  kv: PersistenceKv,
  identity: PersistenceIdentity | (() => PersistenceIdentity),
): CartPersistence {
  return new CartPersistence(kv, identity);
}

import { DurableObject } from "cloudflare:workers";

export type CartOperation =
  | { status: "pending"; attempt: string; fingerprint: string }
  | { status: "completed"; attempt: string; fingerprint: string };

export type CartReceiptItem = {
  upc: string;
  quantity: number;
  modality: "PICKUP" | "DELIVERY";
};

export type CartClaim =
  | CartOperation
  | { status: "started"; attempt: string; fingerprint: string }
  | { status: "conflict" };

export interface CartOperationStore {
  begin(key: string, fingerprint: string): Promise<CartClaim>;
  complete(key: string, attempt: string): Promise<boolean>;
  reject(key: string, attempt: string): Promise<void>;
}

export type CartHistoryItem = CartReceiptItem & { productName?: string };

export type CartHistoryEntry = CartHistoryItem & { addedAt: string };

/** Per-user cart state held next to the journal so every write is atomic. */
export interface CartJournal extends CartOperationStore {
  history(): Promise<CartHistoryEntry[]>;
  appendHistory(items: CartHistoryItem[], addedAt: string): Promise<CartHistoryEntry[]>;
  cartId(): Promise<string | null>;
  saveCartId(cartId: string): Promise<void>;
}

const HISTORY_KEY = "history";
const CART_ID_KEY = "cart-id";
const HISTORY_MAX_ITEMS = 100;
const HISTORY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function cartItemsFingerprint(items: readonly CartReceiptItem[]) {
  return JSON.stringify(
    items.map(({ upc, quantity, modality }) => ({
      upc,
      quantity,
      modality,
    })),
  );
}

function recentHistory(entries: CartHistoryEntry[], now: number): CartHistoryEntry[] {
  return entries.filter((entry) => now - Date.parse(entry.addedAt) < HISTORY_MAX_AGE_MS);
}

/** One journal per user. Pending writes never expire into permission to retry. */
export class CartOperations extends DurableObject<Env> implements CartJournal {
  async begin(key: string, fingerprint: string): Promise<CartClaim> {
    return this.ctx.storage.transaction(async (txn) => {
      const existing = await txn.get<CartOperation>(key);

      if (existing) {
        return existing.fingerprint === fingerprint ? existing : { status: "conflict" };
      }

      const attempt = crypto.randomUUID();
      await txn.put(key, {
        status: "pending",
        attempt,
        fingerprint,
      } satisfies CartOperation);

      return { status: "started", attempt, fingerprint };
    });
  }

  async complete(key: string, attempt: string): Promise<boolean> {
    return this.ctx.storage.transaction(async (txn) => {
      const operation = await txn.get<CartOperation>(key);

      if (!operation || operation.attempt !== attempt) {
        return false;
      }

      await txn.put(key, {
        status: "completed",
        attempt,
        fingerprint: operation.fingerprint,
      } satisfies CartOperation);

      return true;
    });
  }

  /** Only called for a definitive upstream rejection, never a lost response. */
  async reject(key: string, attempt: string): Promise<void> {
    await this.ctx.storage.transaction(async (txn) => {
      const operation = await txn.get<CartOperation>(key);

      if (operation?.status === "pending" && operation.attempt === attempt) {
        await txn.delete(key);
      }
    });
  }

  async history(): Promise<CartHistoryEntry[]> {
    return recentHistory(
      (await this.ctx.storage.get<CartHistoryEntry[]>(HISTORY_KEY)) ?? [],
      Date.now(),
    );
  }

  /** Atomic append, so concurrent adds cannot drop each other's entries. */
  async appendHistory(items: CartHistoryItem[], addedAt: string): Promise<CartHistoryEntry[]> {
    return this.ctx.storage.transaction(async (txn) => {
      const existing = (await txn.get<CartHistoryEntry[]>(HISTORY_KEY)) ?? [];

      const merged = [
        ...recentHistory(existing, Date.parse(addedAt)),
        ...items.map((item) => ({ ...item, addedAt })),
      ].slice(-HISTORY_MAX_ITEMS);

      await txn.put(HISTORY_KEY, merged);

      return merged;
    });
  }

  async cartId(): Promise<string | null> {
    return (await this.ctx.storage.get<string>(CART_ID_KEY)) ?? null;
  }

  async saveCartId(cartId: string): Promise<void> {
    await this.ctx.storage.put(CART_ID_KEY, cartId);
  }
}

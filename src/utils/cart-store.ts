/** Cart state for one user and MCP client, backed by the per-user CartOperations journal. */
import type {
  CartHistoryEntry,
  CartHistoryItem,
  CartJournal,
  CartOperationStore,
} from "../cart-operations.js";

export interface CartStore {
  operations: CartOperationStore;
  cartMirror: {
    getAll(): Promise<CartHistoryEntry[]>;
    append(items: CartHistoryItem[], addedAt: string): Promise<CartHistoryEntry[]>;
  };
  cartId: {
    get(): Promise<string | null>;
    set(cartId: string): Promise<void>;
  };
}

/**
 * Operation keys are scoped to the MCP client so two clients reusing a list ID
 * cannot claim each other's cart writes. Add history and the saved cart ID
 * describe the user's single Kroger cart, so they are shared across clients.
 */
export function createCartStore(journal: CartJournal, clientId: string): CartStore {
  const scoped = (key: string) => JSON.stringify([clientId, key]);

  return {
    operations: {
      begin: (key, fingerprint) => journal.begin(scoped(key), fingerprint),
      complete: (key, attempt) => journal.complete(scoped(key), attempt),
      reject: (key, attempt) => journal.reject(scoped(key), attempt),
    },
    cartMirror: {
      getAll: () => journal.history(),
      append: (items, addedAt) => journal.appendHistory(items, addedAt),
    },
    cartId: {
      get: () => journal.cartId(),
      set: (cartId) => journal.saveCartId(cartId),
    },
  };
}

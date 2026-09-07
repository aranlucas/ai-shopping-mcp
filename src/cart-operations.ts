import { DurableObject } from "cloudflare:workers";

export type CartOperation =
  | { status: "pending"; attempt: string; fingerprint: string }
  | { status: "completed"; attempt: string; fingerprint: string };
export type CartClaim =
  | CartOperation
  | { status: "started"; attempt: string; fingerprint: string }
  | { status: "conflict" };

export interface CartOperationStore {
  begin(key: string, fingerprint: string): Promise<CartClaim>;
  complete(key: string, attempt: string): Promise<boolean>;
  reject(key: string, attempt: string): Promise<void>;
}

/** One journal per user. Pending writes never expire into permission to retry. */
export class CartOperations extends DurableObject<Env> implements CartOperationStore {
  async begin(key: string, fingerprint: string): Promise<CartClaim> {
    return this.ctx.storage.transaction(async (txn) => {
      const existing = await txn.get<CartOperation>(key);
      if (existing) return existing.fingerprint === fingerprint ? existing : { status: "conflict" };
      const attempt = crypto.randomUUID();
      await txn.put(key, { status: "pending", attempt, fingerprint } satisfies CartOperation);
      return { status: "started", attempt, fingerprint };
    });
  }

  async complete(key: string, attempt: string): Promise<boolean> {
    return this.ctx.storage.transaction(async (txn) => {
      const operation = await txn.get<CartOperation>(key);
      if (!operation || operation.attempt !== attempt) return false;
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
      if (operation?.status === "pending" && operation.attempt === attempt) await txn.delete(key);
    });
  }
}

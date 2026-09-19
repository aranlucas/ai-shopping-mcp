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
  /**
   * Reconcile a legacy KV receipt after `begin` has created this attempt.
   * The implementation must atomically either migrate the legacy fingerprint
   * or complete this attempt when both fingerprints agree.
   */
  reconcileLegacy(
    key: string,
    attempt: string,
    fingerprint: string,
    legacyFingerprint: string,
  ): Promise<CartClaim>;
  complete(key: string, attempt: string): Promise<boolean>;
  reject(key: string, attempt: string): Promise<void>;
}

export function cartItemsFingerprint(items: readonly CartReceiptItem[]) {
  return JSON.stringify(
    items.map(({ upc, quantity, modality }) => ({
      upc,
      quantity,
      modality,
    })),
  );
}

/**
 * Claim a cart operation and reconcile a pre-journal receipt when needed.
 *
 * The journal is consulted first. Existing completed, pending, and conflict
 * states never read legacy KV, so a corrupt or expired receipt cannot override
 * authoritative journal state. Only a newly started attempt reads the legacy
 * receipt. A valid receipt is migrated atomically by the journal; a corrupt
 * receipt releases this local claim and blocks the mutation.
 */
export async function claimCartOperation(
  operations: CartOperationStore,
  key: string,
  fingerprint: string,
  readLegacy?: () => Promise<CartReceiptItem[] | null>,
): Promise<CartClaim> {
  const claim = await operations.begin(key, fingerprint);
  if (claim.status !== "started" || !readLegacy) return claim;

  let legacy: CartReceiptItem[] | null;
  try {
    legacy = await readLegacy();
  } catch (error) {
    // No upstream mutation has happened for this attempt. Release the claim
    // so a repaired receipt can be retried without falsely becoming unknown.
    await operations.reject(key, claim.attempt);
    throw error;
  }

  if (!legacy || legacy.length === 0) return claim;

  const legacyFingerprint = cartItemsFingerprint(legacy);
  return operations.reconcileLegacy(
    key,
    claim.attempt,
    fingerprint,
    legacyFingerprint,
  );
}

/** One journal per user. Pending writes never expire into permission to retry. */
export class CartOperations
  extends DurableObject<Env>
  implements CartOperationStore
{
  async begin(key: string, fingerprint: string): Promise<CartClaim> {
    return this.ctx.storage.transaction(async (txn) => {
      const existing = await txn.get<CartOperation>(key);
      if (existing)
        return existing.fingerprint === fingerprint
          ? existing
          : { status: "conflict" };
      const attempt = crypto.randomUUID();
      await txn.put(key, {
        status: "pending",
        attempt,
        fingerprint,
      } satisfies CartOperation);
      return { status: "started", attempt, fingerprint };
    });
  }

  async reconcileLegacy(
    key: string,
    attempt: string,
    fingerprint: string,
    legacyFingerprint: string,
  ): Promise<CartClaim> {
    return this.ctx.storage.transaction(async (txn) => {
      const operation = await txn.get<CartOperation>(key);
      if (
        !operation ||
        operation.status !== "pending" ||
        operation.attempt !== attempt
      ) {
        if (!operation) return { status: "conflict" };
        return operation.fingerprint === fingerprint
          ? operation
          : { status: "conflict" };
      }

      if (legacyFingerprint === fingerprint) {
        const completed = {
          status: "completed" as const,
          attempt,
          fingerprint,
        } satisfies CartOperation;
        await txn.put(key, completed);
        return completed;
      }

      // Preserve the old receipt as the durable authority. This prevents a
      // changed list from replacing a pre-journal cart write and keeps future
      // retries deterministic even after the KV receipt expires.
      const migrated = {
        status: "completed" as const,
        attempt: `legacy:${crypto.randomUUID()}`,
        fingerprint: legacyFingerprint,
      } satisfies CartOperation;
      await txn.put(key, migrated);
      return { status: "conflict" };
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
      if (operation?.status === "pending" && operation.attempt === attempt)
        await txn.delete(key);
    });
  }
}

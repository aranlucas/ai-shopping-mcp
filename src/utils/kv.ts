import { z } from "zod/v4";

/** Minimal KV surface shared by every KV-backed cache in this codebase. */
export type KvLike = Pick<KVNamespace, "get" | "put">;

/** Minimal KV surface needed by identity-bound user persistence. */
export interface PersistenceKv {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: KVNamespacePutOptions,
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

export function isKvLike(value: unknown): value is KvLike {
  return z.object({ get: z.function(), put: z.function() }).safeParse(value)
    .success;
}

/** Resolves the shared user-data KV binding, or null when absent/malformed. */
export function getUserDataKv(env: { USER_DATA_KV?: unknown }): KvLike | null {
  return isKvLike(env?.USER_DATA_KV) ? env.USER_DATA_KV : null;
}

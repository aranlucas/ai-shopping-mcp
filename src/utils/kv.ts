/** Minimal KV surface shared by every KV-backed cache in this codebase. */
export type KvLike = Pick<KVNamespace, "get" | "put">;

export function isKvLike(value: unknown): value is KvLike {
  return !!value && typeof value === "object" && "get" in value && "put" in value;
}

/** Resolves the shared user-data KV binding, or null when absent/malformed. */
export function getUserDataKv(env: Env): KvLike | null {
  return isKvLike(env?.USER_DATA_KV) ? env.USER_DATA_KV : null;
}

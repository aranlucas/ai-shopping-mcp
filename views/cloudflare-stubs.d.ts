/**
 * Minimal Cloudflare Worker type stubs for the views tsconfig.
 * These satisfy transitive imports from src/ files through the views import chain.
 * The real declarations live in worker-configuration.d.ts (main tsconfig only).
 */

declare interface KVNamespace {
  get(key: string, options?: unknown): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expiration?: number; expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
  list(
    options?: unknown,
  ): Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor?: string }>;
}

declare interface Env {
  USER_DATA_KV: KVNamespace;
  ASSETS: { fetch(req: Request): Promise<Response> };
}

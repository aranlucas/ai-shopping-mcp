/**
 * Runtime semantics shared by the deployed Worker (cloudflare.config.ts) and
 * the Workers test pool (vitest.config.ts), so tests run under production behavior.
 * Keep the date at or below the workerd version that the test pool bundles.
 */
export const compatibilityDate = "2026-10-23";

export const compatibilityFlags = [
  "nodejs_compat",
  "global_fetch_strictly_public",
  "enable_ctx_exports",
];

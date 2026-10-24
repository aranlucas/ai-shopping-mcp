import { bindings, defineConfig, exports } from "cf/config";

import * as entrypoint from "./src/server" with { type: "cf-worker" };

export default defineConfig({
  worker: {
    exports: {
      MyMCP: exports.durableObject({ state: "deleted" }),
      CartOperations: exports.durableObject({ storage: "sqlite" }),
      KrogerConnections: exports.durableObject({ state: "deleted" }),
      LoginTransactions: exports.durableObject({ state: "deleted" }),
    },
    name: "ai-meal-planner-mcp",
    compatibilityDate: "2025-03-10",
    compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public", "enable_ctx_exports"],
    entrypoint,
    observability: {
      enabled: true,
    },
    env: {
      MCP_RESOURCE_URL: bindings.text("https://ai-meal-planner-mcp.aranlucas.workers.dev/mcp"),
      SHOPPING_DB: bindings.d1({
        name: "ai-shopping-mcp",
        id: "7a03710e-48aa-445c-832d-fb14197e064b",
      }),
      BETTER_AUTH_ISSUER: bindings.text("https://auth.aranlucas.workers.dev/api/auth"),
      BETTER_AUTH_JWKS_URL: bindings.text("https://auth.aranlucas.workers.dev/api/auth/jwks"),
      AUTH: bindings.worker({ worker: "auth", exportName: "KrogerTokens" }),
      MCP_ALLOWED_ORIGINS: bindings.text("[]"),
      USER_DATA_KV: bindings.kv({
        id: "d7f0b87afb2b49cdbab0ead481cef6ed",
      }),
      ASSETS: bindings.assets(),
    },
  },
});

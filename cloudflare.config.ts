import { bindings, defineConfig, exports, triggers } from "cf/config";

import * as entrypoint from "./src/server" with { type: "cf-worker" };

export default defineConfig({
  worker: ({ isPreview }) => ({
    exports: {
      MyMCP: exports.durableObject({ state: "deleted" }),
      CartOperations: exports.durableObject({ storage: "sqlite" }),
    },
    name: "ai-meal-planner-mcp",
    compatibilityDate: "2025-03-10",
    compatibilityFlags: [
      "nodejs_compat",
      "global_fetch_strictly_public",
      "enable_ctx_exports",
    ],
    entrypoint,
    observability: {
      enabled: true,
    },
    // Worker Previews reject cron triggers.
    ...(!isPreview && {
      triggers: [triggers.scheduled({ schedule: "0 2 * * *" })],
    }),
    env: {
      MCP_RESOURCE_URL: bindings.text(
        "https://ai-meal-planner-mcp.aranlucas.workers.dev",
      ),
      SHOPPING_DB: bindings.d1({
        name: "ai-shopping-mcp",
        id: "7a03710e-48aa-445c-832d-fb14197e064b",
      }),
      OAUTH_KV: bindings.kv({
        id: "8bd5ecd7157942228263703abbabc25f",
      }),
      USER_DATA_KV: bindings.kv({
        id: "d7f0b87afb2b49cdbab0ead481cef6ed",
      }),
      AI: bindings.ai({
        dev: {
          remote: true,
        },
      }),
      ASSETS: bindings.assets(),
    },
  }),
});

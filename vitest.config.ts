import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const liveEval = process.env.EVAL_LIVE === "1";

export default defineConfig({
  test: {
    root: ".",
    testTimeout: 30_000,
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      exclude: ["src/services/kroger/**/*.d.ts"],
    },
    projects: [
      {
        plugins: [
          cloudflareTest({
            main: "./src/server.ts",
            remoteBindings: liveEval,
            ...(liveEval ? { wrangler: { configPath: "./wrangler.jsonc" } } : {}),
            miniflare: {
              ...(liveEval
                ? {}
                : {
                    compatibilityDate: "2025-03-10",
                    compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
                    kvNamespaces: ["OAUTH_KV", "USER_DATA_KV"],
                  }),
              // Miniflare's WorkerOptions expose plain variables through
              // `bindings`, not `vars` (which is wrangler-config syntax). Using
              // `vars` here is silently ignored, so these must live under
              // `bindings` to be available in tests (e.g. in CI, where the
              // gitignored .dev.vars file does not exist).
              bindings: {
                KROGER_CLIENT_ID: "test-kroger-client-id",
                KROGER_CLIENT_SECRET: "test-kroger-client-secret",
                COOKIE_ENCRYPTION_KEY: "test-cookie-secret",
                GATEWAY_URL: "https://gateway.example",
                SHOPPING_SERVICE_SECRET: "test-shopping-service-secret",

                // EVAL_LIVE selects the production Wrangler config so the
                // live-model runner can reach its explicitly remote AI
                // binding. Normal tests define only their local KV bindings.
                ...(process.env.EVAL_LIVE ? { EVAL_LIVE: process.env.EVAL_LIVE } : {}),
                ...(process.env.EVAL_MODEL ? { EVAL_MODEL: process.env.EVAL_MODEL } : {}),
                ...(process.env.EVAL_LOG ? { EVAL_LOG: process.env.EVAL_LOG } : {}),
              },
            },
          }),
        ],
        test: {
          name: "worker",
          testTimeout: 30_000,
          include: ["tests/**/*.test.ts"],
        },
      },
    ],
  },
});

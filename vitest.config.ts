import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

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
            remoteBindings: false,
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              // Miniflare's WorkerOptions expose plain variables through
              // `bindings`, not `vars` (which is wrangler-config syntax). Using
              // `vars` here is silently ignored, so these must live under
              // `bindings` to be available in tests (e.g. in CI, where the
              // gitignored .dev.vars file does not exist).
              bindings: {
                KROGER_CLIENT_ID: "test-kroger-client-id",
                KROGER_CLIENT_SECRET: "test-kroger-client-secret",
                COOKIE_ENCRYPTION_KEY: "test-cookie-secret",
                // Opt-in knobs for tests/evals: the live-model runner (Workers
                // AI via the remote-proxied env.AI binding) only runs with
                // EVAL_LIVE=1; EVAL_LOG prints token tables.
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

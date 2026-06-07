import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: ".",
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
              vars: {
                KROGER_CLIENT_ID: "test-kroger-client-id",
                KROGER_CLIENT_SECRET: "test-kroger-client-secret",
                COOKIE_ENCRYPTION_KEY: "test-cookie-secret",
              },
            },
          }),
        ],
        test: {
          name: "worker",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/package-manager.test.ts"],
        },
      },
      {
        test: {
          name: "node",
          environment: "node",
          include: ["tests/package-manager.test.ts"],
        },
      },
    ],
  },
});

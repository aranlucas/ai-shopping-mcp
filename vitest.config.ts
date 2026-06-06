import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
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
    root: ".",
    include: ["tests/**/*.test.ts"],
  },
});

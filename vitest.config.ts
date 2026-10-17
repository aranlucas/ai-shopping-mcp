import { readFileSync } from "node:fs";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

type TestOptions = Extract<Parameters<typeof cloudflareTest>[0], { miniflare?: object }>;

type TestMiniflare = NonNullable<TestOptions["miniflare"]>;

const miniflare: TestMiniflare = {
  compatibilityDate: "2025-03-10",
  compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public", "enable_ctx_exports"],
  serviceBindings: { AUTH: { name: "auth-stub", entrypoint: "KrogerTokens" } },
  workers: [
    {
      name: "auth-stub",
      modules: true,
      script: readFileSync("test/auth-stub.mjs", "utf8"),
      compatibilityDate: "2025-03-10",
    },
  ],
  kvNamespaces: ["USER_DATA_KV"],
  d1Databases: ["SHOPPING_DB"],
  durableObjects: {
    CART_OPERATIONS: {
      className: "CartOperations",
      useSQLite: true,
    },
    KROGER_CONNECTIONS: { className: "KrogerConnections", useSQLite: true },
  },
  // Miniflare exposes plain variables through `bindings`. Keep test values
  // explicit so CI does not depend on the gitignored .dev.vars file.
  bindings: {
    BETTER_AUTH_ISSUER: "https://auth.example/api/auth",
    BETTER_AUTH_JWKS_URL: "https://auth.example/api/auth/jwks",
    MCP_RESOURCE_URL: "https://example.com/mcp",
    MCP_ALLOWED_ORIGINS: '["https://client.example"]',
  },
};

if (process.env.EVAL_LOG && miniflare.bindings) {
  miniflare.bindings.EVAL_LOG = process.env.EVAL_LOG;
}

const resolve = { tsconfigPaths: true };

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
        resolve,
        plugins: [
          cloudflareTest({
            main: "./src/server.ts",
            miniflare,
          }),
        ],
        test: {
          name: "worker",
          testTimeout: 30_000,
          // With @cloudflare/vitest-plugin 1.4.3, a worker that loads modules
          // another test file already cached exits during startup.
          fsModuleCache: false,
          include: ["test/**/*.test.ts"],
          exclude: ["test/node/**"],
        },
      },
      {
        resolve,
        test: {
          name: "node",
          environment: "node",
          include: ["test/node/**/*.test.ts"],
        },
      },
    ],
  },
});

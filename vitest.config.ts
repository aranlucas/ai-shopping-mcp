import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// The agent eval reads OPENROUTER_API_KEY from .dev.vars when it isn't exported.
if (process.env.EVAL_AGENT === "1" && !process.env.OPENROUTER_API_KEY) {
  try {
    process.loadEnvFile(".dev.vars");
  } catch {
    // No .dev.vars: the agent eval skips itself without a key.
  }
}

type TestOptions = Extract<
  Parameters<typeof cloudflareTest>[0],
  { miniflare?: object }
>;

type TestMiniflare = NonNullable<TestOptions["miniflare"]>;

const miniflare: TestMiniflare = {
  compatibilityDate: "2025-03-10",
  compatibilityFlags: [
    "nodejs_compat",
    "global_fetch_strictly_public",
    "enable_ctx_exports",
  ],
  kvNamespaces: ["USER_DATA_KV"],
  d1Databases: ["SHOPPING_DB"],
  durableObjects: {
    CART_OPERATIONS: {
      className: "CartOperations",
      useSQLite: true,
    },
    KROGER_CONNECTIONS: { className: "KrogerConnections", useSQLite: true },
    LOGIN_TRANSACTIONS: { className: "LoginTransactions", useSQLite: true },
  },
  // Miniflare's WorkerOptions expose plain variables through
  // `bindings`, not `vars` (which is wrangler-config syntax). Using
  // `vars` here is silently ignored, so these must live under
  // `bindings` to be available in tests (e.g. in CI, where the
  // gitignored .dev.vars file does not exist).
  bindings: {
    KROGER_CLIENT_ID: "test-kroger-client-id",
    KROGER_CLIENT_SECRET: "test-kroger-client-secret",
    BETTER_AUTH_ISSUER: "https://auth.example/api/auth",
    BETTER_AUTH_JWKS_URL: "https://auth.example/api/auth/jwks",
    BETTER_AUTH_CLIENT_ID: "shopping-browser",
    BETTER_AUTH_CLIENT_SECRET: "test-browser-secret",
    MCP_RESOURCE_URL: "https://example.com/mcp",
    MCP_ALLOWED_ORIGINS: '["https://client.example"]',

    // Agent eval over OpenRouter (`pnpm eval:agent`).
    ...Object.fromEntries(
      ["EVAL_AGENT", "EVAL_MODELS", "EVAL_TASKS", "OPENROUTER_API_KEY"].flatMap(
        (name) => (process.env[name] ? [[name, process.env[name]]] : []),
      ),
    ),
  },
};

if (process.env.EVAL_CODEX_PORT) {
  miniflare.serviceBindings = {
    EVAL_CODEX_DRIVER: {
      external: {
        address: `127.0.0.1:${process.env.EVAL_CODEX_PORT}`,
        http: {},
      },
    },
  };
}

if (process.env.EVAL_LOG && miniflare.bindings) {
  miniflare.bindings.EVAL_LOG = process.env.EVAL_LOG;
}

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
            miniflare,
          }),
        ],
        test: {
          name: "worker",
          testTimeout: 30_000,
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/node/**"],
        },
      },
      {
        test: {
          name: "node",
          environment: "node",
          include: ["tests/node/**/*.test.ts"],
        },
      },
    ],
  },
});

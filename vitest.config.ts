import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";
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
  // Miniflare's WorkerOptions expose plain variables through
  // `bindings`, not `vars` (which is wrangler-config syntax). Using
  // `vars` here is silently ignored, so these must live under
  // `bindings` to be available in tests (e.g. in CI, where the
  // gitignored .dev.vars file does not exist).
  bindings: {
    BETTER_AUTH_ISSUER: "https://auth.example/api/auth",
    BETTER_AUTH_JWKS_URL: "https://auth.example/api/auth/jwks",
    MCP_RESOURCE_URL: "https://example.com/mcp",
    MCP_ALLOWED_ORIGINS: '["https://client.example"]',

    // Agent eval over OpenRouter (`pnpm eval:agent`).
    ...Object.fromEntries(
      ["EVAL_AGENT", "EVAL_MODELS", "EVAL_TASKS", "OPENROUTER_API_KEY"].flatMap((name) =>
        process.env[name] ? [[name, process.env[name]]] : [],
      ),
    ),
  },
};

if (process.env.EVAL_CODEX_PORT) {
  miniflare.serviceBindings = {
    ...miniflare.serviceBindings,
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

const resolve = {
  alias: {
    "@": fileURLToPath(new URL("./src", import.meta.url)),
    "@test": fileURLToPath(new URL("./test", import.meta.url)),
  },
};

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
          include: ["test/**/*.test.ts"],
          exclude: ["test/node/**"],
        },
      },
      {
        resolve,
        test: {
          name: "node",
          environment: "node",
          include: ["test/node/**/*.test.ts", "test/scripts/**/*.test.mjs"],
          // This opt-in command requires live Cloudflare AI access.
          exclude: ["test/scripts/selector-live.test.mjs"],
        },
      },
    ],
  },
});

import type { KrogerTokens } from "./services/auth-rpc.js";

// String-named external bindings are generated as Fetcher; add Auth's public RPC contract.
declare global {
  namespace Cloudflare {
    interface Env {
      AUTH: Service<KrogerTokens>;
    }
  }
}

export type AppEnv = Env & {
  BETTER_AUTH_ISSUER: string;
  BETTER_AUTH_JWKS_URL: string;
  MCP_ALLOWED_ORIGINS?: string;
  SENTRY_DSN?: string;
};

import type { KrogerTokens } from "./services/auth-rpc.js";

export type AppEnv = Env & {
  AUTH: Service<KrogerTokens>;
  BETTER_AUTH_ISSUER: string;
  BETTER_AUTH_JWKS_URL: string;
  MCP_ALLOWED_ORIGINS?: string;
  SENTRY_DSN?: string;
};

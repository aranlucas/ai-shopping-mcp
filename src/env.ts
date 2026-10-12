export type AppEnv = Env & {
  KROGER_CLIENT_ID: string;
  KROGER_CLIENT_SECRET: string;
  BETTER_AUTH_ISSUER: string;
  BETTER_AUTH_JWKS_URL: string;
  BETTER_AUTH_CLIENT_ID: string;
  BETTER_AUTH_CLIENT_SECRET: string;
  MCP_ALLOWED_ORIGINS?: string;
  SENTRY_DSN?: string;
};

export type AppEnv = Env & {
  COOKIE_ENCRYPTION_KEY: string;
  GATEWAY_URL: string;
  KROGER_CLIENT_ID: string;
  KROGER_CLIENT_SECRET: string;
  SHOPPING_SERVICE_SECRET: string;
};

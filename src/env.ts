export type AppEnv = Env & {
  COOKIE_ENCRYPTION_KEY: string;
  GATEWAY_URL: string;
  KROGER_CLIENT_ID: string;
  KROGER_CLIENT_SECRET: string;
  SENTRY_DSN?: string;
  /**
   * Overrides the Trader Joe's storefront GraphQL endpoint. Trader Joe's sits
   * behind bot management that rejects some egress addresses, so this exists to
   * point at an allowed proxy without a code change.
   */
  TRADER_JOES_GRAPHQL_URL?: string;
  /** Store code Trader Joe's prices are quoted against. */
  TRADER_JOES_STORE_CODE?: string;
};

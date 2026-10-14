import { applyD1Migrations, env } from "cloudflare:test";

import shoppingSchema from "../migrations/0000_flawless_sister_grimm.sql?raw";

/** Run the same SQL used by Wrangler migrations in local Worker tests. */
export async function ensureShoppingSchema(): Promise<void> {
  await applyD1Migrations(env.SHOPPING_DB, [
    {
      name: "0000_flawless_sister_grimm.sql",
      queries: shoppingSchema
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean),
    },
  ]);
}

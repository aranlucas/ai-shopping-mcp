/**
 * TypeScript types inferred from server-side Zod schemas.
 * Import these with `import type` from views — Vite strips type-only
 * imports so no server code gets bundled into the client.
 */
import type { z } from "zod";
import type { addToCartInputSchema } from "./cart.js";
import type { manageShoppingListInputSchema } from "./shopping-list.js";

export type AddToCartArgs = z.infer<typeof addToCartInputSchema>;
export type ManageShoppingListArgs = z.infer<
  typeof manageShoppingListInputSchema
>;

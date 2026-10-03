import type { z } from "zod";

import type { addShoppingListToCartInputSchema } from "./cart.js";
import type { updateInventoryInputSchema } from "./inventory.js";
import type { recordOrderInputSchema } from "./orders.js";
import type {
  createShoppingListInputSchema,
  getShoppingListInputSchema,
  updateShoppingListInputSchema,
} from "./shopping-list.js";

export type AddShoppingListToCartArgs = z.infer<
  typeof addShoppingListToCartInputSchema
>;

export type CreateShoppingListArgs = z.input<
  typeof createShoppingListInputSchema
>;

export type UpdateInventoryArgs = z.input<typeof updateInventoryInputSchema>;

export type UpdateShoppingListArgs = z.input<
  typeof updateShoppingListInputSchema
>;

export type GetShoppingListArgs = z.input<typeof getShoppingListInputSchema>;

export type RecordOrderArgs = z.input<typeof recordOrderInputSchema>;

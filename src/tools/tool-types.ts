import type { z } from "zod";

import type { addShoppingListToCartInputSchema } from "./cart.js";
import type {
  addToInventoryInputSchema,
  removeFromInventoryInputSchema,
} from "./inventory.js";
import type { recordOrderInputSchema } from "./orders.js";
import type {
  addShoppingListItemsInputSchema,
  createShoppingListInputSchema,
  editShoppingListItemInputSchema,
  getShoppingListInputSchema,
} from "./shopping-list.js";

export type AddShoppingListToCartArgs = z.infer<
  typeof addShoppingListToCartInputSchema
>;
export type CreateShoppingListArgs = z.input<
  typeof createShoppingListInputSchema
>;
export type AddToInventoryArgs = z.infer<typeof addToInventoryInputSchema>;
export type RemoveFromInventoryArgs = z.infer<
  typeof removeFromInventoryInputSchema
>;
export type AddShoppingListItemsArgs = z.input<
  typeof addShoppingListItemsInputSchema
>;
export type EditShoppingListItemArgs = z.input<
  typeof editShoppingListItemInputSchema
>;
export type GetShoppingListArgs = z.input<typeof getShoppingListInputSchema>;
export type RecordOrderArgs = z.input<typeof recordOrderInputSchema>;

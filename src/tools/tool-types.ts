import type { z } from "zod";

import type { addShoppingListToCartInputSchema } from "./cart.js";
import type { addPantryItemsInputSchema, removePantryItemsInputSchema } from "./pantry.js";
import type { createShoppingListInputSchema } from "./shopping-list.js";

export type AddShoppingListToCartArgs = z.infer<typeof addShoppingListToCartInputSchema>;
export type CreateShoppingListArgs = z.infer<typeof createShoppingListInputSchema>;
export type AddPantryItemsArgs = z.infer<typeof addPantryItemsInputSchema>;
export type RemovePantryItemsArgs = z.infer<typeof removePantryItemsInputSchema>;

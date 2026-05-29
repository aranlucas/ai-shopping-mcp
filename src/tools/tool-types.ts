import type { z } from "zod";

import type { addToCartInputSchema } from "./cart.js";
import type { managePantryInputSchema } from "./inventory.js";
import type { manageShoppingListInputSchema } from "./shopping-list.js";

export type AddToCartArgs = z.infer<typeof addToCartInputSchema>;
export type ManageShoppingListArgs = z.infer<typeof manageShoppingListInputSchema>;
export type ManagePantryArgs = z.infer<typeof managePantryInputSchema>;

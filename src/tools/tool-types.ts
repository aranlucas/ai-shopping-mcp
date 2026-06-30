import type { z } from "zod";

import type { addToCartInputSchema } from "./cart.js";
import type { managePantryInputSchema } from "./pantry.js";
import type { createShoppingListInputSchema } from "./shopping-list.js";

export type AddToCartArgs = z.infer<typeof addToCartInputSchema>;
export type CreateShoppingListArgs = z.infer<typeof createShoppingListInputSchema>;
export type ManagePantryArgs = z.infer<typeof managePantryInputSchema>;

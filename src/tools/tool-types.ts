import type { z } from "zod";

import type { addShoppingListToCartInputSchema } from "./cart.js";
import type { addToInventoryInputSchema, removeFromInventoryInputSchema } from "./inventory.js";
import type { createShoppingListInputSchema } from "./shopping-list.js";

export type AddShoppingListToCartArgs = z.infer<typeof addShoppingListToCartInputSchema>;
export type CreateShoppingListArgs = z.infer<typeof createShoppingListInputSchema>;
export type AddToInventoryArgs = z.infer<typeof addToInventoryInputSchema>;
export type RemoveFromInventoryArgs = z.infer<typeof removeFromInventoryInputSchema>;

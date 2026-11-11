import * as z from "zod/v4";

/** Pantry or equipment entries one inventory call may add or remove. */
export const MAX_INVENTORY_BATCH = 50;

/** Items one order record or one list change/remove batch may carry. */
export const MAX_ITEM_BATCH = 100;

/** Stored items per list; above the largest meal plan (7 meals x 40 ingredients). */
export const MAX_LIST_ITEMS = 300;

export const upcSchema = z
  .string()
  .trim()
  .refine((value) => /^\d{1,13}$/.test(value), {
    message:
      "UPC must be up to 13 digits — copy the upc value from search_products output exactly, including leading zeros.",
  })
  .transform((value) => value.padStart(13, "0"));

export const storeIdSchema = z
  .string()
  .trim()
  .refine((value) => value.length === 8, {
    message: "Store ID must be the 8-character storeId from search_stores output.",
  });

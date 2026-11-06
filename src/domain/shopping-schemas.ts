import * as z from "zod/v4";

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

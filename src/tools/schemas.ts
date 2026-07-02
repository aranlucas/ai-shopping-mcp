/**
 * Shared Zod schema helpers for tool input validation.
 *
 * Small models struggle to recover from strict validation rejections, so these
 * helpers normalize common inputs (UPCs, store IDs, quantities) instead of
 * rejecting reasonable variations outright.
 */
import * as z from "zod/v4";

/**
 * A UPC field that trims whitespace, accepts 1-13 digits, and left-pads to 13
 * digits. Rejects anything that isn't digits with a message that tells the
 * model exactly what to do next.
 */
export const upcSchema = z
  .string()
  .trim()
  .refine((value) => /^\d{1,13}$/.test(value), {
    message:
      "UPC must be up to 13 digits — copy the upc value from search_products output exactly, including leading zeros.",
  })
  .transform((value) => value.padStart(13, "0"));

/**
 * A store ID field that trims whitespace and requires exactly 8 characters,
 * matching the `storeId` returned by search_stores.
 */
export const storeIdSchema = z
  .string()
  .trim()
  .refine((value) => value.length === 8, {
    message: "Store ID must be the 8-character storeId from search_stores output.",
  });

/** A quantity field coerced from string/number input, bounded by min/max. */
export function quantitySchema(min: number, max: number) {
  return z.coerce.number().min(min).max(max);
}

/** Case-insensitive modality enum: lowercase or mixed-case input is upper-cased before validation. */
export const modalityEnum = z.preprocess(
  (value) => (typeof value === "string" ? value.toUpperCase() : value),
  z.enum(["DELIVERY", "PICKUP"]),
);

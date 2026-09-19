/**
 * Shared Zod schema helpers for tool input validation.
 *
 * Small models struggle to recover from strict validation rejections, so these
 * helpers normalize common inputs (UPCs, store IDs, quantities) instead of
 * rejecting reasonable variations outright.
 */
import * as z from "zod/v4";

export { upcSchema } from "../domain/product-identity.js";

/**
 * A store ID field that trims whitespace and requires exactly 8 characters,
 * matching the `storeId` returned by search_stores.
 */
export const storeIdSchema = z
  .string()
  .trim()
  .refine((value) => value.length === 8, {
    message:
      "Store ID must be the 8-character storeId from search_stores output.",
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

/**
 * A boolean field that also accepts the strings "true"/"false" (any case,
 * trimmed), since small models sometimes stringify booleans. Plain
 * `z.coerce.boolean()` would treat the string "false" as truthy.
 */
export const coercedBooleanSchema = z.preprocess((value) => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return value;
}, z.boolean());

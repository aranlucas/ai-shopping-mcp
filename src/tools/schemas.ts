/**
 * Shared Zod schema helpers for tool input validation.
 *
 * Small models struggle to recover from strict validation rejections, so these
 * helpers normalize common inputs (UPCs, store IDs, quantities) instead of
 * rejecting reasonable variations outright.
 */
import * as z from "zod/v4";

export function quantitySchema(min: number, max: number) {
  return z.coerce.number().min(min).max(max);
}

export const modalityEnum = z.preprocess(
  (value) => {
    const parsed = z.string().safeParse(value);

    return parsed.success ? parsed.data.toUpperCase() : value;
  },
  z.enum(["DELIVERY", "PICKUP"]),
);

/**
 * A boolean field that also accepts the strings "true"/"false" (any case,
 * trimmed), since small models sometimes stringify booleans. Plain
 * `z.coerce.boolean()` would treat the string "false" as truthy.
 */
export const coercedBooleanSchema = z.preprocess((value) => {
  const parsed = z.string().safeParse(value);

  if (parsed.success) {
    const normalized = parsed.data.trim().toLowerCase();

    if (normalized === "true") {
      return true;
    }

    if (normalized === "false") {
      return false;
    }
  }

  return value;
}, z.boolean());

import { z } from "zod/v4";

/** Reject the legacy shared fallback even on grants issued before this check. */
export function isVerifiedShopperId(value: unknown): value is string {
  return z
    .string()
    .refine(
      (id) => id.trim().length > 0 && id !== "unknown" && id === id.trim(),
    )
    .safeParse(value).success;
}

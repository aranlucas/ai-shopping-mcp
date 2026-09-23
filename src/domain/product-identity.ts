import * as z from "zod/v4";

const providerPattern = /^[a-z][a-z0-9_]{0,63}$/u;

/** Legacy product identity, retained only for wire compatibility. */
export const productReferenceSchema = z.object({
  provider: z.string().regex(providerPattern),
  id: z.string().trim().min(1).max(255),
});

/** The canonical domain UPC form shared by tools and compatibility code. */
export const upcSchema = z
  .string()
  .trim()
  .refine((value) => /^\d{1,13}$/.test(value), {
    message:
      "UPC must be up to 13 digits — copy the upc value from search_products output exactly, including leading zeros.",
  })
  .transform((value) => value.padStart(13, "0"));

/** Normalize a Kroger UPC, returning undefined for non-Kroger/invalid ids. */
function normalizeKrogerUpc(
  value: string | null | undefined,
): string | undefined {
  if (value == null) return undefined;
  const parsed = upcSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Decode the copyable legacy Kroger reference once, at the tool input
 * boundary.  The schema output is the same normalized UPC used by the
 * domain, so handlers never need to parse or prioritize two identities.
 */
export const productReferenceInputSchema = z
  .string()
  .trim()
  .startsWith("kroger:", { message: "productRef must be kroger:<UPC>." })
  .transform((value) => value.slice("kroger:".length))
  .pipe(upcSchema);

/**
 * Convert legacy compatibility fields into the domain UPC. An explicit
 * non-Kroger product is intentionally terminal: a legacy UPC next to it must
 * not accidentally make a named non-Kroger item cartable.
 */
export function normalizeProductIdentity(input: {
  product?: { provider: string; id: string } | null;
  upc?: string | null;
}): string | undefined {
  if (input.product != null) {
    return input.product.provider === "kroger"
      ? normalizeKrogerUpc(input.product.id)
      : undefined;
  }
  return normalizeKrogerUpc(input.upc);
}

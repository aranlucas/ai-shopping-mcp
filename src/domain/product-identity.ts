import * as z from "zod/v4";
import {
  parseProductReference,
  type ProductReference,
} from "../services/catalog/types.js";

export const productReferenceSchema = z.object({
  provider: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
  id: z.string().trim().min(1).max(255),
});

/** Decode the copyable wire reference once, at the tool input boundary. */
export const productReferenceInputSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const reference = parseProductReference(value);
    if (reference) return reference;
    ctx.addIssue({
      code: "custom",
      message: "productRef must be <provider>:<provider-scoped-id>.",
    });
    return z.NEVER;
  });

/** Explicit universal identity wins over any deprecated Kroger compatibility field. */
export function normalizeProductIdentity(input: {
  product?: ProductReference | null;
  upc?: string | null;
}): ProductReference | undefined {
  return (
    input.product ??
    (input.upc ? { provider: "kroger", id: input.upc } : undefined)
  );
}

/** Kroger adapters consume canonical identity; legacy fields never reach this point. */
export function krogerProductId(
  product: ProductReference | undefined,
): string | undefined {
  return product?.provider === "kroger" ? product.id : undefined;
}

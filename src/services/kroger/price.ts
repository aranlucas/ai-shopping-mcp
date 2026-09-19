/** Kroger uses promo=0 to mean no promotion, not a free product. */
export function normalizeKrogerPrice(price?: {
  regular?: number;
  promo?: number;
}) {
  const regular = price?.regular;
  const promo = price?.promo;
  const hasPromo = promo != null && promo > 0 && promo !== regular;
  return {
    price: hasPromo ? promo : regular,
    regularPrice: hasPromo ? regular : undefined,
  };
}

export function formatKrogerPrice(price?: {
  regular?: number;
  promo?: number;
}): string | undefined {
  const normalized = normalizeKrogerPrice(price);
  if (normalized.price === undefined) return undefined;
  return normalized.regularPrice === undefined
    ? `$${normalized.price}`
    : `$${normalized.price} (was $${normalized.regularPrice})`;
}

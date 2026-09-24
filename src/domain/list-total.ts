/** Sum of known unit prices times quantity; unpriced items are skipped. */
export function estimateListTotal(
  items: ReadonlyArray<{ quantity: number; price?: number }>,
): { total: number; pricedCount: number } {
  let total = 0;
  let pricedCount = 0;
  for (const item of items) {
    if (item.price === undefined) continue;
    total += item.price * item.quantity;
    pricedCount += 1;
  }
  return { total: Math.round(total * 100) / 100, pricedCount };
}

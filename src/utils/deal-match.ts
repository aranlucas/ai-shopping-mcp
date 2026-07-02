/**
 * Fuzzy matching between a plain-language shopping item name (e.g. "chicken
 * breast") and scraped QFC/Kroger deal titles (e.g. "Kroger Boneless
 * Skinless Chicken Breasts, Value Pack, Family Pack"). Deal titles are messy
 * free text, so this uses normalized token overlap rather than substring or
 * exact matching. See docs/small-model-efficiency-plan.md, "Server-side AI"
 * item 9.
 */
import type { NormalizedWeeklyDeal } from "../services/qfc-weekly-deals.js";

export type Deal = NormalizedWeeklyDeal;

/** A deal matches when at least this fraction of the item's tokens appear in its title. */
const OVERLAP_THRESHOLD = 0.6;

/**
 * Lowercases, strips punctuation, splits on whitespace, and cheaply
 * singularizes trailing "s" (words longer than 3 characters only, so short
 * words like "gas" or "bus" are left alone).
 */
function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word));
}

/**
 * Finds the best-matching deal for a shopping item name: a deal matches when
 * every normalized item token appears in the (normalized) deal title, or when
 * the fraction of item tokens found is at least `OVERLAP_THRESHOLD`. Returns
 * the highest-overlap match, or undefined when nothing clears the bar.
 */
export function findDealForItem(itemName: string, deals: Deal[]): Deal | undefined {
  const itemTokens = normalizeTokens(itemName);
  if (itemTokens.length === 0) return undefined;

  let best: { deal: Deal; ratio: number } | undefined;

  for (const deal of deals) {
    const dealTokens = new Set(normalizeTokens(deal.title));
    if (dealTokens.size === 0) continue;

    const matchedCount = itemTokens.filter((token) => dealTokens.has(token)).length;
    const ratio = matchedCount / itemTokens.length;
    const allMatch = matchedCount === itemTokens.length;

    if ((allMatch || ratio >= OVERLAP_THRESHOLD) && (!best || ratio > best.ratio)) {
      best = { deal, ratio };
    }
  }

  return best?.deal;
}

/**
 * Fuzzy matching between a plain-language shopping item name (e.g. "chicken
 * breast") and scraped QFC/Kroger deal titles (e.g. "Kroger Boneless
 * Skinless Chicken Breasts, Value Pack, Family Pack"). Deal titles are messy
 * free text, so this uses normalized token overlap rather than substring or
 * exact matching.
 */
import type { NormalizedWeeklyDeal } from "../services/qfc-weekly-deals.js";

type RankedDeal = { deal: Deal; ratio: number };

export type Deal = NormalizedWeeklyDeal;

const OVERLAP_THRESHOLD = 0.6;

function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word));
}

export function findDealForItem(itemName: string, deals: Deal[]): Deal | undefined {
  const itemTokens = normalizeTokens(itemName);

  if (itemTokens.length === 0) {
    return undefined;
  }

  let best: RankedDeal | undefined;

  for (const deal of deals) {
    const dealTokens = new Set(normalizeTokens(deal.title));

    if (dealTokens.size === 0) {
      continue;
    }

    const matchedCount = itemTokens.filter((token) => dealTokens.has(token)).length;

    const ratio = matchedCount / itemTokens.length;
    const allMatch = matchedCount === itemTokens.length;

    if ((allMatch || ratio >= OVERLAP_THRESHOLD) && (!best || ratio > best.ratio)) {
      best = { deal, ratio };
    }
  }

  return best?.deal;
}

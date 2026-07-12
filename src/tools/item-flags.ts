/**
 * Best-effort pantry/deal annotations shared by `shop_for_items` and
 * `create_shopping_list`: a short " | in pantry" / " | on sale: $X" suffix
 * per line, saving the model a separate `get_shopping_profile` or
 * `get_weekly_deals` call. Both flags are best-effort — any storage or cache
 * error yields no flag, never a failed tool call. See
 * docs/small-model-efficiency-plan.md Phase 3 item 6.
 */
import type { Deal } from "../utils/deal-match.js";
import type { PantryItem } from "../utils/user-storage.js";

import { findDealForItem } from "../utils/deal-match.js";
import { getUserDataKv } from "../utils/kv.js";
import { type ToolContext } from "./types.js";
import { buildWeeklyDealsCacheKey, parseCacheEntry } from "./weekly-deals.js";

/** Best-effort pantry fetch: any storage error yields an empty list, never a throw. */
export async function getPantryForFlags(ctx: ToolContext): Promise<PantryItem[]> {
  try {
    return await ctx.storage.pantry.getAll();
  } catch {
    return [];
  }
}

/**
 * Best-effort weekly-deals lookup for line-item flags. Reads the KV cache
 * `get_weekly_deals` populates (with its default `limit`/`pageLimit`)
 * ONLY — this never fetches the QFC circular inline. Returns an empty list
 * (no flags, no failure) when the cache is cold, past its stale grace
 * window, or corrupted.
 */
export async function getDealsForFlags(
  ctx: ToolContext,
  locationId: string | undefined,
): Promise<Deal[]> {
  try {
    const kv = getUserDataKv(ctx.getEnv());
    if (!kv) return [];

    const cacheKey = buildWeeklyDealsCacheKey({ locationId, limit: 50, pageLimit: 2 });
    const raw = await kv.get(cacheKey);
    const entry = parseCacheEntry(raw);
    if (!entry || Date.now() > entry.staleUntil) return [];

    return entry.data.deals;
  } catch {
    return [];
  }
}

/**
 * Case-insensitive containment match (either direction) between the
 * requested item name and a pantry item's product name, e.g. "milk" matches
 * "Whole Milk".
 */
export function pantryFlagLabel(requestedName: string, pantry: PantryItem[]): string | undefined {
  const lower = requestedName.toLowerCase().trim();
  if (!lower) return undefined;

  const inPantry = pantry.some((item) => {
    const itemLower = item.productName.toLowerCase();
    return itemLower.includes(lower) || lower.includes(itemLower);
  });

  return inPantry ? "in pantry" : undefined;
}

/** Fuzzy-matches the requested name against deal titles; undefined when nothing matches. */
export function dealFlagLabel(requestedName: string, deals: Deal[]): string | undefined {
  const deal = findDealForItem(requestedName, deals);
  if (!deal) return undefined;
  return deal.price ? `on sale: ${deal.price}` : "on sale";
}

export function itemFlagLabels(
  requestedName: string,
  pantry: PantryItem[],
  deals: Deal[],
): string[] {
  const labels: string[] = [];
  const pantryLabel = pantryFlagLabel(requestedName, pantry);
  if (pantryLabel) labels.push(pantryLabel);

  const dealLabel = dealFlagLabel(requestedName, deals);
  if (dealLabel) labels.push(dealLabel);

  return labels;
}

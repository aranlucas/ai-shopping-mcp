import type { ToolContext } from "./types.js";

import { REQUEST_TIMEOUT_MS } from "../utils/request-timeout.js";
import { loadWeeklyDeals } from "./weekly-deals.js";

const MEAL_PLANNING_DEAL_LIMIT = 10;

/** Optional context: a deal outage must not discard the shopper's pantry context. */
export async function getMealPlanningDeals(ctx: ToolContext, storeId?: string): Promise<string> {
  // Share the default get_weekly_deals cache and fetch limits; only the summary is smaller.
  const result = await loadWeeklyDeals(ctx, {
    storeId,
    limit: 50,
    pageLimit: 2,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (result.isErr()) {
    return `\n**Weekly Deals Unavailable:** ${result.error.message}\nContinue with pantry context; use get_weekly_deals to retry.`;
  }

  const { data, cacheState } = result.value;
  const deals = data.deals.slice(0, MEAL_PLANNING_DEAL_LIMIT);
  const parts = [
    `\n**Weekly Deals (QFC/Kroger):** storeId=${data.locationId} | cache=${cacheState}`,
    `Showing ${deals.length} of ${data.deals.length} offers.`,
  ];
  if (cacheState === "stale") {
    parts.push(
      "This cached ad is stale; offers may have ended. Confirm current prices with search_products.",
    );
  }
  for (const warning of data.warnings) parts.push(`Warning: ${warning}`);
  if (deals.length === 0)
    parts.push("No weekly offers found. Plan from pantry and regular-price ingredients.");

  for (const deal of deals) {
    const circular = deal.source === "print" ? data.printCircular : data.shoppableCircular;
    const validFrom = deal.validFrom ?? circular?.eventStartDate;
    const validTill = deal.validTill ?? circular?.eventEndDate;
    const fields = [
      deal.title,
      deal.details,
      deal.price,
      deal.savings,
      deal.loyalty,
      deal.disclaimer,
      validFrom ? `from ${validFrom}` : undefined,
      validTill ? `until ${validTill}` : undefined,
    ];
    parts.push(`- ${fields.filter(Boolean).join(" | ")}`);
  }
  if (data.deals.length > deals.length) parts.push("Use get_weekly_deals for more offers.");
  return parts.join("\n");
}

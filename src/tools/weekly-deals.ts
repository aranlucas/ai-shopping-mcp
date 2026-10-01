import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { QfcDealsApiResponse } from "../services/weekly-deals/schema.js";
import type { WeeklyDealsLoader } from "../services/weekly-deals/service.js";

import { appResult } from "../app-results.js";
import {
  formatWeeklyDealAppWarnings,
  formatWeeklyDealWarnings,
} from "../services/weekly-deals/format.js";
import {
  DEAL_CATEGORIES,
  classifyDealCategory,
} from "../utils/deal-category.js";
import { formatWeeklyDealsMarkdown } from "../utils/format-response.js";
import { toMcpError } from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { storeIdSchema } from "./schemas.js";

export type {
  LoadedWeeklyDeals,
  WeeklyDealsLoader,
} from "../services/weekly-deals/service.js";
export type { WeeklyDealsCacheEntry } from "../services/weekly-deals/schema.js";
export {
  addWeeklyDealsWarning as addCacheWarning,
  buildWeeklyDealsCacheKey,
  getLatestCircularEndTime,
  parseWeeklyDealsCacheEntry as parseCacheEntry,
} from "../services/weekly-deals/cache.js";

export type WeeklyDealsToolDependencies = {
  loadWeeklyDeals: WeeklyDealsLoader;
};

export function registerWeeklyDealsTools(
  server: McpServer,
  { loadWeeklyDeals }: WeeklyDealsToolDependencies,
): void {
  registerAppTool(
    server,
    "get_weekly_deals",
    {
      title: "Get Weekly Deals",
      description:
        "Fetches this week's QFC/Kroger sale items and promotions. Returns deal titles, prices, and savings. Use this when the user wants to know what's on sale or wants to plan meals around current discounts.",
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: z.object({
        storeId: storeIdSchema
          .optional()
          .describe(
            "8-character storeId from search_stores. Uses your preferred store if omitted.",
          ),
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .default(15)
          .describe("Number of deals per page (1-50)"),
        offset: z.coerce
          .number()
          .int()
          .min(0)
          .optional()
          .default(0)
          .describe(
            "Deals to skip; pass the nextOffset from the previous page",
          ),
      }),
    },
    async ({ storeId, limit, offset }, requestContext) => {
      // Always load the shared cache entry (item flags and meal planning read
      // it too); `limit` only trims what is shown.
      const result = await loadWeeklyDeals({
        storeId,
        ...WEEKLY_DEALS_FETCH,
        signal: requestContext.mcpReq.signal,
      });
      if (result.isErr()) return toMcpError(result.error);
      return formatWeeklyDealsToolResponse(
        result.value.data,
        result.value.cacheState,
        { limit, offset },
      );
    },
  );
}

/** Page footer: which slice this is and how to get the next one. */
function formatDealsPage(offset: number, shown: number, total: number) {
  if (shown === total) return "";
  const end = offset + shown;
  if (shown === 0) return `\nNo deals at offset ${offset}; there are ${total}.`;
  return end < total
    ? `\nDeals ${offset + 1}-${end} of ${total}. More: nextOffset=${end}`
    : `\nDeals ${offset + 1}-${end} of ${total} (last page).`;
}

/** Fetch size behind every weekly-deals read, so all readers share one cache key. */
export const WEEKLY_DEALS_FETCH = { limit: 50, pageLimit: 2 } as const;

export function formatWeeklyDealsToolResponse(
  result: QfcDealsApiResponse,
  cacheState: "miss" | "fresh" | "stale",
  page: { limit: number; offset: number } = {
    limit: WEEKLY_DEALS_FETCH.limit,
    offset: 0,
  },
) {
  const validFrom =
    result.printCircular?.eventStartDate ??
    result.shoppableCircular?.eventStartDate ??
    result.deals.find((d) => d.validFrom)?.validFrom;
  const validTill =
    result.printCircular?.eventEndDate ??
    result.shoppableCircular?.eventEndDate ??
    result.deals.find((d) => d.validTill)?.validTill;

  const deals = result.deals
    .map((deal) => ({
      title: deal.title,
      details: deal.details,
      price: deal.price,
      savings: deal.savings,
      validFrom: deal.validFrom,
      validTill: deal.validTill,
      category: classifyDealCategory(deal.title),
    }))
    .slice(page.offset, page.offset + page.limit)
    .toSorted(
      (a, b) =>
        DEAL_CATEGORIES.indexOf(a.category) -
        DEAL_CATEGORIES.indexOf(b.category),
    );

  return {
    content: [
      {
        type: "text" as const,
        text:
          formatWeeklyDealsMarkdown(
            deals,
            validFrom,
            validTill,
            formatWeeklyDealWarnings(result.warnings),
          ) + formatDealsPage(page.offset, deals.length, result.deals.length),
      },
    ],
    ...appResult("get_weekly_deals", {
      deals,
      validFrom,
      validTill,
      cache: { state: cacheState },
      warnings: formatWeeklyDealAppWarnings(result.warnings),
      storeId: result.locationId,
    }),
  };
}

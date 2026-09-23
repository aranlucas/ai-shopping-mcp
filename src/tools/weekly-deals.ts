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
          .max(200)
          .optional()
          .default(50)
          .describe("Maximum number of deals to return"),
        pageLimit: z.coerce
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .default(2)
          .describe("Print-ad fallback only: number of ad pages to parse"),
      }),
    },
    async ({ storeId, limit, pageLimit }, requestContext) => {
      const result = await loadWeeklyDeals({
        storeId,
        limit,
        pageLimit,
        signal: requestContext.mcpReq.signal,
      });
      if (result.isErr()) return toMcpError(result.error);
      return formatWeeklyDealsToolResponse(
        result.value.data,
        result.value.cacheState,
      );
    },
  );
}

export function formatWeeklyDealsToolResponse(
  result: QfcDealsApiResponse,
  cacheState: "miss" | "fresh" | "stale",
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
    .toSorted(
      (a, b) =>
        DEAL_CATEGORIES.indexOf(a.category) -
        DEAL_CATEGORIES.indexOf(b.category),
    );

  return {
    content: [
      {
        type: "text" as const,
        text: formatWeeklyDealsMarkdown(
          deals,
          validFrom,
          validTill,
          formatWeeklyDealWarnings(result.warnings),
        ),
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

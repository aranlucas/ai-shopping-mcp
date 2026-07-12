import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { ResultAsync, okAsync } from "neverthrow";
import * as z from "zod/v4";

import type { AppError } from "../errors.js";
import type { QfcDealsApiResponse } from "../services/qfc-weekly-deals.js";
import type { KvLike } from "../utils/kv.js";
import type { ToolContext } from "./types.js";

import { networkError, notFoundError, storageError } from "../errors.js";
import { getQfcWeeklyDeals } from "../services/qfc-weekly-deals.js";
import { DEAL_CATEGORIES, classifyDealCategory } from "../utils/deal-category.js";
import { formatWeeklyDealsMarkdown } from "../utils/format-response.js";
import { safeJsonParseWithSchema } from "../utils/json.js";
import { getUserDataKv } from "../utils/kv.js";
import { getProps, safeResolveLocationId, toMcpError } from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { storeIdSchema } from "./schemas.js";

export type WeeklyDealsCacheEntry = {
  version: 1;
  createdAt: number;
  freshUntil: number;
  staleUntil: number;
  data: QfcDealsApiResponse;
};

type CacheReadResult =
  | { kind: "miss" }
  | { kind: "fresh"; entry: WeeklyDealsCacheEntry }
  | { kind: "stale"; entry: WeeklyDealsCacheEntry };

const WEEKLY_DEALS_CACHE_VERSION = 1;
const FRESH_CACHE_MS = 6 * 60 * 60 * 1000;
const STALE_GRACE_MS = 48 * 60 * 60 * 1000;

const weeklyDealsCacheDataSchema = z
  .looseObject({
    sourceMode: z.enum(["search_api", "print_fallback"]),
    locationId: z.string(),
    divisionCode: z.string(),
    warnings: z.array(z.string()),
    deals: z.array(
      z.looseObject({
        id: z.string(),
        title: z.string(),
        source: z.enum(["search_api", "print"]),
      }),
    ),
  })
  .transform((data): QfcDealsApiResponse => data as QfcDealsApiResponse);

const weeklyDealsCacheEntrySchema = z
  .looseObject({
    version: z.literal(1),
    createdAt: z.number(),
    freshUntil: z.number(),
    staleUntil: z.number(),
    data: weeklyDealsCacheDataSchema,
  })
  .transform(
    (entry): WeeklyDealsCacheEntry => ({
      version: entry.version,
      createdAt: entry.createdAt,
      freshUntil: entry.freshUntil,
      staleUntil: entry.staleUntil,
      data: entry.data,
    }),
  );

export function buildWeeklyDealsCacheKey(params: {
  locationId?: string;
  limit: number;
  pageLimit: number;
}): string {
  const locationId = params.locationId || "default";
  return [
    "qfc",
    "weekly-deals",
    `v${WEEKLY_DEALS_CACHE_VERSION}`,
    `loc:${locationId}`,
    `limit:${params.limit}`,
    `pages:${params.pageLimit}`,
  ].join("|");
}

export function parseCacheEntry(raw: string | null): WeeklyDealsCacheEntry | null {
  if (!raw) return null;
  return safeJsonParseWithSchema(raw, weeklyDealsCacheEntrySchema).match(
    (entry) => entry,
    () => null,
  );
}

function readWeeklyDealsCacheSafe(
  kv: KvLike | null,
  key: string,
): ResultAsync<CacheReadResult, AppError> {
  if (!kv) return okAsync({ kind: "miss" as const });

  return ResultAsync.fromPromise(kv.get(key), (e) =>
    storageError(`Failed to read cache: ${e instanceof Error ? e.message : String(e)}`, e),
  ).map((raw) => {
    const entry = parseCacheEntry(raw);
    if (!entry) return { kind: "miss" as const };

    const now = Date.now();
    if (now <= entry.freshUntil) return { kind: "fresh" as const, entry };
    if (now <= entry.staleUntil) return { kind: "stale" as const, entry };
    return { kind: "miss" as const };
  });
}

export function getLatestCircularEndTime(result: QfcDealsApiResponse): number | null {
  const candidates = [result.shoppableCircular?.eventEndDate, result.printCircular?.eventEndDate]
    .map((value) => (value ? Date.parse(value) : Number.NaN))
    .filter((value) => Number.isFinite(value));

  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

function writeWeeklyDealsCache(
  kv: KvLike | null,
  key: string,
  data: QfcDealsApiResponse,
): ResultAsync<void, AppError> {
  if (!kv) return okAsync(undefined);

  const now = Date.now();
  const eventEnd = getLatestCircularEndTime(data);
  const freshUntil = eventEnd ? Math.min(now + FRESH_CACHE_MS, eventEnd) : now + FRESH_CACHE_MS;
  const staleUntil = eventEnd
    ? Math.max(freshUntil, eventEnd + STALE_GRACE_MS)
    : now + FRESH_CACHE_MS + STALE_GRACE_MS;

  const entry: WeeklyDealsCacheEntry = {
    version: 1,
    createdAt: now,
    freshUntil,
    staleUntil,
    data,
  };

  const expirationTtl = Math.max(300, Math.ceil((staleUntil - now) / 1000));
  return ResultAsync.fromPromise(kv.put(key, JSON.stringify(entry), { expirationTtl }), (e) =>
    storageError(`Cache write failed: ${e instanceof Error ? e.message : String(e)}`, e),
  );
}

export function addCacheWarning(result: QfcDealsApiResponse, message: string): QfcDealsApiResponse {
  return {
    ...result,
    warnings: [...result.warnings, message],
  };
}

export function registerWeeklyDealsTools(ctx: ToolContext) {
  registerAppTool(
    ctx.server,
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
    async ({ storeId, limit, pageLimit }) => {
      let resolvedStoreId = storeId;
      if (!resolvedStoreId) {
        const resolved = await safeResolveLocationId(ctx.storage, getProps().id, undefined);
        if (resolved.isErr()) {
          return toMcpError(
            notFoundError(
              "No store set. Use search_stores then set_preferred_store, or pass storeId.",
            ),
          );
        }
        resolvedStoreId = resolved.value.locationId;
      }

      const kv = getUserDataKv(ctx.getEnv());
      const cacheKey = buildWeeklyDealsCacheKey({
        locationId: resolvedStoreId,
        limit,
        pageLimit,
      });

      // Read cache using Result
      const cacheResult = await readWeeklyDealsCacheSafe(kv, cacheKey);

      let staleEntry: WeeklyDealsCacheEntry | null = null;

      const cached = cacheResult.match(
        (value) => value,
        () => null,
      );
      if (cached) {
        if (cached.kind === "fresh") {
          const result = addCacheWarning(cached.entry.data, "Served from KV cache.");
          return formatWeeklyDealsToolResponse(result, "fresh");
        }
        if (cached.kind === "stale") {
          staleEntry = cached.entry;
        }
      }

      // Fetch live data
      const liveResult = await ResultAsync.fromPromise(
        (async () => {
          const { productClient } = ctx.clients;
          const result = await getQfcWeeklyDeals({
            locationId: resolvedStoreId,
            limit,
            pageLimit,
            searchProducts: async (term, locId, searchLimit) => {
              const { data, error } = await productClient.GET("/v1/products", {
                params: {
                  query: {
                    "filter.term": term,
                    "filter.locationId": locId,
                    "filter.limit": searchLimit,
                  },
                },
              });
              if (error) return [];
              return data?.data || [];
            },
          });
          await writeWeeklyDealsCache(kv, cacheKey, result).orTee((e) =>
            console.warn("Cache write failed (non-fatal):", e.message),
          );
          return result;
        })(),
        (e): AppError =>
          networkError(
            `Failed to fetch weekly deals: ${e instanceof Error ? e.message : String(e)}`,
            e,
          ),
      );

      return liveResult.match(
        (liveData) => formatWeeklyDealsToolResponse(liveData, "miss"),
        (error) => {
          if (staleEntry) {
            const staleData = addCacheWarning(
              staleEntry.data,
              `Live refresh failed; served stale KV cache. (${error.message})`,
            );
            return formatWeeklyDealsToolResponse(staleData, "stale");
          }
          return toMcpError(error);
        },
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
    .sort((a, b) => DEAL_CATEGORIES.indexOf(a.category) - DEAL_CATEGORIES.indexOf(b.category));

  return {
    content: [
      {
        type: "text" as const,
        text: formatWeeklyDealsMarkdown(deals, validFrom, validTill, result.warnings),
      },
    ],
    structuredContent: {
      _view: "get_weekly_deals",
      deals,
      validFrom,
      validTill,
      cache: { state: cacheState },
    },
  };
}

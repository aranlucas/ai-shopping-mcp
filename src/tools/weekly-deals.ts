import { err, fromThrowable, ok, okAsync, ResultAsync } from "neverthrow";
import { createElement } from "react";
import { z } from "zod";
import type { AppError } from "../errors.js";
import { networkError, storageError } from "../errors.js";
import type { QfcDealsApiResponse } from "../services/qfc-weekly-deals.js";
import { getQfcWeeklyDeals } from "../services/qfc-weekly-deals.js";
import { formatWeeklyDealsListCompact } from "../utils/format-response.js";
import { WeeklyDeals } from "../utils/ui/weekly-deals.js";
import { registerAppToolWithUI, storeReactHtml } from "../utils/ui-resource.js";
import { errorResult, type ToolContext } from "./types.js";

type KvLike = Pick<KVNamespace, "get" | "put">;

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

export function isKvLike(value: unknown): value is KvLike {
  return (
    !!value && typeof value === "object" && "get" in value && "put" in value
  );
}

const safeGetCacheKv = fromThrowable(
  (ctx: ToolContext) => {
    const env = ctx.getEnv();
    return isKvLike(env?.USER_DATA_KV) ? env.USER_DATA_KV : null;
  },
  () => null,
);

function getCacheKv(ctx: ToolContext): KvLike | null {
  return safeGetCacheKv(ctx).unwrapOr(null);
}

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

const safeJsonParse = fromThrowable(
  (raw: string) => JSON.parse(raw) as WeeklyDealsCacheEntry,
  () => null,
);

export function parseCacheEntry(
  raw: string | null,
): WeeklyDealsCacheEntry | null {
  if (!raw) return null;
  return safeJsonParse(raw)
    .map((parsed) => {
      if (
        !parsed ||
        parsed.version !== 1 ||
        typeof parsed.freshUntil !== "number" ||
        typeof parsed.staleUntil !== "number" ||
        !parsed.data
      ) {
        return null;
      }
      return parsed;
    })
    .unwrapOr(null);
}

function readWeeklyDealsCacheSafe(
  kv: KvLike | null,
  key: string,
): ResultAsync<CacheReadResult, AppError> {
  if (!kv) return okAsync({ kind: "miss" as const });

  return ResultAsync.fromPromise(kv.get(key), (e) =>
    storageError(
      `Failed to read cache: ${e instanceof Error ? e.message : String(e)}`,
      e,
    ),
  ).map((raw) => {
    const entry = parseCacheEntry(raw);
    if (!entry) return { kind: "miss" as const };

    const now = Date.now();
    if (now <= entry.freshUntil) return { kind: "fresh" as const, entry };
    if (now <= entry.staleUntil) return { kind: "stale" as const, entry };
    return { kind: "miss" as const };
  });
}

export function getLatestCircularEndTime(
  result: QfcDealsApiResponse,
): number | null {
  const candidates = [
    result.shoppableCircular?.eventEndDate,
    result.printCircular?.eventEndDate,
  ]
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
  const freshUntil = eventEnd
    ? Math.min(now + FRESH_CACHE_MS, eventEnd)
    : now + FRESH_CACHE_MS;
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
  return ResultAsync.fromPromise(
    kv.put(key, JSON.stringify(entry), { expirationTtl }),
    (e) =>
      storageError(
        `Cache write failed: ${e instanceof Error ? e.message : String(e)}`,
        e,
      ),
  );
}

export function addCacheWarning(
  result: QfcDealsApiResponse,
  message: string,
): QfcDealsApiResponse {
  return {
    ...result,
    warnings: [...result.warnings, message],
  };
}

const WEEKLY_DEALS_URI = "ui://weekly-deals/app.html";

export function registerWeeklyDealsTools(ctx: ToolContext) {
  registerAppToolWithUI(
    ctx,
    "get_weekly_deals",
    WEEKLY_DEALS_URI,
    "Weekly Deals",
    {
      title: "Get Weekly Deals",
      description:
        "Fetches current QFC/Kroger weekly deals from the print ad (DACS), then augments each deal with real pricing from the Kroger Product Search API. Falls back to search-API-only deal discovery if print-ad parsing fails.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: z.object({
        locationId: z
          .string()
          .length(8, { message: "Location ID must be exactly 8 characters" })
          .optional()
          .describe(
            "QFC/Kroger location ID (8 digits). Defaults to a QFC Seattle store if omitted.",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .default(50)
          .describe("Maximum number of deals to return"),
        pageLimit: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .default(2)
          .describe("Print-ad fallback only: number of ad pages to parse"),
      }),
    },
    async ({ locationId, limit, pageLimit }) => {
      const kv = getCacheKv(ctx);
      const cacheKey = buildWeeklyDealsCacheKey({
        locationId,
        limit,
        pageLimit,
      });

      // Read cache using Result
      const cacheResult = await readWeeklyDealsCacheSafe(kv, cacheKey);

      let staleEntry: WeeklyDealsCacheEntry | null = null;

      if (cacheResult.isOk()) {
        const cached = cacheResult.value;
        if (cached.kind === "fresh") {
          const result = addCacheWarning(
            cached.entry.data,
            "Served from KV cache.",
          );
          return formatWeeklyDealsToolResponse(ctx, result, "fresh");
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
            locationId,
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

      return liveResult
        .map((data) => formatWeeklyDealsToolResponse(ctx, data, "miss"))
        .orElse((liveError) => {
          if (staleEntry) {
            const staleData = addCacheWarning(
              staleEntry.data,
              `Live refresh failed; served stale KV cache. (${liveError.message})`,
            );
            return ok(formatWeeklyDealsToolResponse(ctx, staleData, "stale"));
          }
          return err(liveError);
        })
        .match(
          (response) => response,
          (error) =>
            errorResult(`Failed to fetch weekly deals: ${error.message}`),
        );
    },
  );
}

export function formatWeeklyDealsToolResponse(
  ctx: ToolContext,
  result: QfcDealsApiResponse,
  cacheState: "miss" | "fresh" | "stale",
) {
  const formattedDeals = formatWeeklyDealsListCompact(
    result.deals.map((deal) => ({
      product: deal.title,
      details: deal.details,
      price: deal.price || "See weekly ad",
      savings: deal.savings,
    })),
  );

  const validFrom =
    result.printCircular?.eventStartDate ??
    result.shoppableCircular?.eventStartDate ??
    result.deals.find((d) => d.validFrom)?.validFrom;
  const validTill =
    result.printCircular?.eventEndDate ??
    result.shoppableCircular?.eventEndDate ??
    result.deals.find((d) => d.validTill)?.validTill;

  const headerLines: string[] = [];
  if (validFrom && validTill)
    headerLines.push(`Valid: ${validFrom} – ${validTill}`);
  if (result.warnings.length > 0)
    headerLines.push(`Warnings: ${result.warnings.join(" | ")}`);

  const text =
    headerLines.length > 0
      ? `${headerLines.join("\n")}\n\n${formattedDeals}`
      : formattedDeals;

  storeReactHtml(
    ctx,
    WEEKLY_DEALS_URI,
    createElement(WeeklyDeals, {
      deals: result.deals.map((deal) => ({
        title: deal.title,
        details: deal.details,
        price: deal.price,
        savings: deal.savings,
        validFrom: deal.validFrom,
        validTill: deal.validTill,
      })),
      validFrom,
      validTill,
    }),
  );

  return {
    content: [
      {
        type: "text" as const,
        text,
      },
    ],
    structuredContent: {
      ...(result as unknown as Record<string, unknown>),
      cache: { state: cacheState },
    },
  };
}

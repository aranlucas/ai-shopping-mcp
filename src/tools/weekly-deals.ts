import { z } from "zod";
import type { QfcDealsApiResponse } from "../services/qfc-weekly-deals.js";
import { getQfcWeeklyDeals } from "../services/qfc-weekly-deals.js";
import { formatWeeklyDealsList } from "../utils/format-response.js";
import type { ToolContext } from "./types.js";

type KvLike = Pick<KVNamespace, "get" | "put">;

type WeeklyDealsCacheEntry = {
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

function isKvLike(value: unknown): value is KvLike {
  return (
    !!value && typeof value === "object" && "get" in value && "put" in value
  );
}

function getCacheKv(ctx: ToolContext): KvLike | null {
  try {
    const env = ctx.getEnv();
    if (isKvLike(env?.USER_DATA_KV)) return env.USER_DATA_KV;
    return null;
  } catch {
    return null;
  }
}

function buildWeeklyDealsCacheKey(params: {
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

function parseCacheEntry(raw: string | null): WeeklyDealsCacheEntry | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as WeeklyDealsCacheEntry;
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
  } catch {
    return null;
  }
}

async function readWeeklyDealsCache(
  kv: KvLike | null,
  key: string,
): Promise<CacheReadResult> {
  if (!kv) return { kind: "miss" };
  const raw = await kv.get(key);
  const entry = parseCacheEntry(raw);
  if (!entry) return { kind: "miss" };

  const now = Date.now();
  if (now <= entry.freshUntil) return { kind: "fresh", entry };
  if (now <= entry.staleUntil) return { kind: "stale", entry };
  return { kind: "miss" };
}

function getLatestCircularEndTime(result: QfcDealsApiResponse): number | null {
  const candidates = [
    result.shoppableCircular?.eventEndDate,
    result.printCircular?.eventEndDate,
  ]
    .map((value) => (value ? Date.parse(value) : Number.NaN))
    .filter((value) => Number.isFinite(value));

  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

async function writeWeeklyDealsCache(
  kv: KvLike | null,
  key: string,
  data: QfcDealsApiResponse,
): Promise<void> {
  if (!kv) return;

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
  await kv.put(key, JSON.stringify(entry), { expirationTtl });
}

function addCacheWarning(
  result: QfcDealsApiResponse,
  message: string,
): QfcDealsApiResponse {
  return {
    ...result,
    warnings: [...result.warnings, message],
  };
}

export function registerWeeklyDealsTools(ctx: ToolContext) {
  ctx.server.registerTool(
    "get_weekly_deals",
    {
      title: "Get Weekly Deals",
      description:
        "Fetches current QFC/Kroger weekly deals by searching the Kroger Product API for on-sale items across common grocery categories. Falls back to print-ad parsing if the search API is unavailable.",
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
          .default(25)
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

      let staleEntry: WeeklyDealsCacheEntry | null = null;

      try {
        const cached = await readWeeklyDealsCache(kv, cacheKey);
        if (cached.kind === "fresh") {
          const result = addCacheWarning(
            cached.entry.data,
            "Served from KV cache.",
          );
          return formatWeeklyDealsToolResponse(result, "fresh");
        }
        if (cached.kind === "stale") {
          staleEntry = cached.entry;
        }

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
        await writeWeeklyDealsCache(kv, cacheKey, result);

        return formatWeeklyDealsToolResponse(result, "miss");
      } catch (error) {
        if (staleEntry) {
          const staleResult = addCacheWarning(
            staleEntry.data,
            `Live refresh failed; served stale KV cache. (${error instanceof Error ? error.message : String(error)})`,
          );
          return formatWeeklyDealsToolResponse(staleResult, "stale");
        }

        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: `Failed to fetch weekly deals: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

function formatWeeklyDealsToolResponse(
  result: QfcDealsApiResponse,
  cacheState: "miss" | "fresh" | "stale",
) {
  const formattedDeals = formatWeeklyDealsList(
    result.deals.map((deal) => ({
      product: deal.title,
      details: deal.details,
      price: deal.price || "See weekly ad",
      savings: deal.savings,
      loyalty: deal.loyalty,
      department: deal.department,
      validFrom: deal.validFrom,
      validTill: deal.validTill,
      disclaimer: deal.disclaimer,
    })),
  );

  const sourceLabel =
    result.sourceMode === "print_fallback"
      ? "Print ad (DACS)"
      : "Kroger Product Search API (on-sale items, fallback)";

  const lines: string[] = [
    `Weekly deals source: ${sourceLabel}`,
    `Location: ${result.locationId} (division ${result.divisionCode})`,
    `Deals returned: ${result.deals.length}`,
  ];

  if (cacheState !== "miss") {
    lines.push(
      `Cache: ${cacheState === "fresh" ? "KV hit (fresh)" : "KV hit (stale)"}`,
    );
  }

  if (result.meta?.termCount !== undefined) {
    lines.push(`Search categories: ${result.meta.termCount}`);
  }

  if (result.warnings.length > 0) {
    lines.push(`Warnings: ${result.warnings.join(" | ")}`);
  }

  return {
    content: [
      {
        type: "text" as const,
        text: `${lines.join("\n")}\n\n${formattedDeals}`,
      },
    ],
    structuredContent: {
      ...(result as unknown as Record<string, unknown>),
      cache: { state: cacheState },
    },
  };
}

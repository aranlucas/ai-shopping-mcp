import { ResultAsync, okAsync } from "neverthrow";

import type { AppError } from "../../errors.js";
import type { KvLike } from "../../utils/kv.js";
import { safeJsonParseWithSchema } from "../../utils/json.js";
import type {
  QfcDealsApiResponse,
  WeeklyDealWarning,
  WeeklyDealsCacheEntry,
} from "./schema.js";

import { storageError } from "../../errors.js";
import { weeklyDealCacheEntrySchema } from "./schema.js";

export const WEEKLY_DEALS_CACHE_VERSION = 1;
export const FALLBACK_FRESH_CACHE_MS = 6 * 60 * 60 * 1000;
export const STALE_GRACE_MS = 48 * 60 * 60 * 1000;

export type CacheReadResult =
  | { kind: "miss" }
  | { kind: "fresh"; entry: WeeklyDealsCacheEntry }
  | { kind: "stale"; entry: WeeklyDealsCacheEntry };

/**
 * Weekly-deals cache contract used by services and tools.
 *
 * The Worker binding is optional in some deployments. That infrastructure
 * detail is handled once by `createWeeklyDealsCache`; consumers always get a
 * cache object whose missing-binding behavior is a normal cache miss.
 */
export interface WeeklyDealsCache {
  read(key: string): ResultAsync<CacheReadResult, AppError>;
  write(key: string, data: QfcDealsApiResponse): ResultAsync<void, AppError>;
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

/** Parse and normalize a complete cached record. */
export function parseWeeklyDealsCacheEntry(
  raw: string | null,
): WeeklyDealsCacheEntry | null {
  if (!raw) return null;
  return safeJsonParseWithSchema(raw, weeklyDealCacheEntrySchema).match(
    (entry) => entry,
    () => null,
  );
}

export function readWeeklyDealsCache(
  kv: KvLike,
  key: string,
): ResultAsync<CacheReadResult, AppError> {
  return ResultAsync.fromThrowable(
    () => kv.get(key),
    (error) =>
      storageError(
        `Failed to read cache: ${error instanceof Error ? error.message : String(error)}`,
        error,
      ),
  )().map((raw) => {
    const entry = parseWeeklyDealsCacheEntry(raw);
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

  return candidates.length > 0 ? Math.max(...candidates) : null;
}

export function writeWeeklyDealsCache(
  kv: KvLike,
  key: string,
  data: QfcDealsApiResponse,
): ResultAsync<void, AppError> {
  const now = Date.now();
  const eventEnd = getLatestCircularEndTime(data);
  const freshUntil = eventEnd ?? now + FALLBACK_FRESH_CACHE_MS;
  const staleUntil = freshUntil + STALE_GRACE_MS;
  const entry: WeeklyDealsCacheEntry = {
    version: WEEKLY_DEALS_CACHE_VERSION,
    createdAt: now,
    freshUntil,
    staleUntil,
    data,
  };

  const expiration = Math.max(
    Math.ceil(staleUntil / 1000),
    Math.ceil(now / 1000) + 60,
  );
  return ResultAsync.fromThrowable(
    () => kv.put(key, JSON.stringify(entry), { expiration }),
    (error) =>
      storageError(
        `Cache write failed: ${error instanceof Error ? error.message : String(error)}`,
        error,
      ),
  )();
}

/** Adapt the optional Worker KV binding to the non-null service contract. */
export function createWeeklyDealsCache(kv: KvLike | null): WeeklyDealsCache {
  if (!kv) {
    return {
      read: () => okAsync({ kind: "miss" as const }),
      write: () => okAsync(undefined),
    };
  }

  return {
    read: (key) => readWeeklyDealsCache(kv, key),
    write: (key, data) => writeWeeklyDealsCache(kv, key, data),
  };
}

export function addWeeklyDealsWarning(
  result: QfcDealsApiResponse,
  warning: WeeklyDealWarning,
): QfcDealsApiResponse {
  return {
    ...result,
    warnings: [...result.warnings, warning],
  };
}

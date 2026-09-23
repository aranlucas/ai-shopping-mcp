import { ResultAsync, err, ok, type Result } from "neverthrow";

import type { AppError } from "../../errors.js";
import type { QfcDealsApiResponse, WeeklyDealsCacheEntry } from "./schema.js";
import type { WeeklyDealsCache } from "./cache.js";

import {
  AppErrorException,
  networkError,
  notFoundError,
} from "../../errors.js";
import {
  addWeeklyDealsWarning as addWarning,
  buildWeeklyDealsCacheKey,
} from "./cache.js";
import { weeklyDealWarning } from "./schema.js";

export type WeeklyDealsServiceDependencies = {
  resolveLocationId: (
    storeId: string | undefined,
  ) => ResultAsync<string, AppError>;
  weeklyDealsCache: WeeklyDealsCache;
  fetchLive: (params: {
    locationId: string;
    limit: number;
    pageLimit: number;
    signal?: AbortSignal;
  }) => Promise<QfcDealsApiResponse>;
};

export type LoadedWeeklyDeals = {
  data: QfcDealsApiResponse;
  cacheState: "miss" | "fresh" | "stale";
};

export type WeeklyDealsLoadParams = {
  storeId?: string;
  limit: number;
  pageLimit: number;
  signal?: AbortSignal;
};

export type WeeklyDealsLoader = (
  params: WeeklyDealsLoadParams,
) => Promise<Result<LoadedWeeklyDeals, AppError>>;

/**
 * Shared cache/live policy for weekly deals.  MCP tools provide dependencies
 * through `WeeklyDealsServiceDependencies`; this module owns stale fallback,
 * degraded refresh handling, and cache write policy.
 */
export async function loadWeeklyDeals(
  deps: WeeklyDealsServiceDependencies,
  { storeId, limit, pageLimit, signal }: WeeklyDealsLoadParams,
): Promise<Result<LoadedWeeklyDeals, AppError>> {
  const locationResult = await deps.resolveLocationId(storeId);
  if (locationResult.isErr()) {
    return err(
      locationResult.error.type === "NOT_FOUND"
        ? notFoundError(
            "No store set. Use search_stores then set_preferred_store, or pass storeId.",
          )
        : locationResult.error,
    );
  }

  const locationId = locationResult.value;
  const cacheKey = buildWeeklyDealsCacheKey({ locationId, limit, pageLimit });
  const cacheResult = await deps.weeklyDealsCache.read(cacheKey);
  const cacheReadError = cacheResult.isErr() ? cacheResult.error : undefined;

  let staleEntry: WeeklyDealsCacheEntry | null = null;
  if (cacheResult.isOk()) {
    if (cacheResult.value.kind === "fresh") {
      return ok({
        data: addWarning(
          cacheResult.value.entry.data,
          weeklyDealWarning("cache_served"),
        ),
        cacheState: "fresh",
      });
    }
    if (cacheResult.value.kind === "stale") {
      staleEntry = cacheResult.value.entry;
    }
  }

  const liveResult = await ResultAsync.fromPromise(
    (async () => {
      const liveData = await deps.fetchLive({
        locationId,
        limit,
        pageLimit,
        ...(signal ? { signal } : {}),
      });
      // A timed-out source must not replace a usable stale entry or be cached
      // as a successful empty response.
      signal?.throwIfAborted();
      return liveData;
    })(),
    (error): AppError =>
      error instanceof AppErrorException
        ? error.appError
        : networkError(
            `Failed to fetch weekly deals: ${error instanceof Error ? error.message : String(error)}`,
            error,
          ),
  );

  if (liveResult.isOk()) {
    let liveData = liveResult.value;
    const degraded = liveData.meta?.degraded === true;

    if (degraded && staleEntry) {
      return ok({
        data: addWarning(
          staleEntry.data,
          weeklyDealWarning("live_refresh_partial", {
            action: "served_stale_cache",
          }),
        ),
        cacheState: "stale",
      });
    }

    if (cacheReadError) {
      liveData = addWarning(
        liveData,
        weeklyDealWarning("cache_read_failed", {
          error: cacheReadError.message,
        }),
      );
    }

    if (degraded) {
      liveData = addWarning(
        liveData,
        weeklyDealWarning("live_refresh_partial", {
          action: "not_cached",
        }),
      );
    } else if (!cacheReadError) {
      const cacheWriteResult = await deps.weeklyDealsCache.write(
        cacheKey,
        liveData,
      );
      if (cacheWriteResult.isErr()) {
        liveData = addWarning(
          liveData,
          weeklyDealWarning("cache_write_failed", {
            error: cacheWriteResult.error.message,
          }),
        );
      }
    }

    return ok({ data: liveData, cacheState: "miss" });
  }

  if (staleEntry) {
    return ok({
      data: addWarning(
        staleEntry.data,
        weeklyDealWarning("live_refresh_failed", {
          error: liveResult.error.message,
        }),
      ),
      cacheState: "stale",
    });
  }

  return err(liveResult.error);
}

/**
 * Reads the cache for best-effort item annotations.  The caller intentionally
 * gets stale entries during the grace period, but never triggers a network
 * fetch or exposes cache/storage errors to a shopping tool.
 */
export async function getCachedWeeklyDealsForFlags(
  weeklyDealsCache: WeeklyDealsCache,
  params: { locationId?: string; limit: number; pageLimit: number },
): Promise<QfcDealsApiResponse | null> {
  const key = buildWeeklyDealsCacheKey(params);
  const result = await weeklyDealsCache.read(key);
  if (result.isErr()) return null;
  if (result.value.kind === "miss") return null;
  return result.value.entry.data;
}

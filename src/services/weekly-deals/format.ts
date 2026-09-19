import type { WeeklyDealWarning } from "./schema.js";

function detail(
  warning: WeeklyDealWarning,
  key: string,
): string | number | boolean | undefined {
  return warning.details?.[key];
}

function detailText(warning: WeeklyDealWarning, key: string): string {
  const value = detail(warning, key);
  return value === undefined ? "unknown error" : String(value);
}

/** Convert a domain warning into text for a human/model-facing response. */
export function formatWeeklyDealWarning(warning: WeeklyDealWarning): string {
  switch (warning.code) {
    case "legacy":
      return String(detail(warning, "message") ?? "Weekly deals warning.");
    case "circular_fetch_failed":
      return `Unable to fetch weekly circulars for date context: ${detailText(warning, "error")}`;
    case "print_ad_failed":
      return `Print-ad parsing failed; falling back to search API. (${detailText(warning, "error")})`;
    case "print_ad_partial":
      return `Print-ad data is partial; ${detail(warning, "failedPages") ?? "?"} of ${detail(warning, "totalPages") ?? "?"} page(s) could not be read.`;
    case "search_augmentation_failed":
      return `Search API pricing augmentation failed: ${detailText(warning, "error")}`;
    case "search_partial":
      return `Weekly deal search was partial: ${detail(warning, "failedTerms") ?? "?"} of ${detail(warning, "totalTerms") ?? "?"} category searches failed.`;
    case "search_failed":
      return `Search API deal fetch also failed. (${detailText(warning, "error")})`;
    case "cache_served":
      return "Served from KV cache.";
    case "cache_read_failed":
      return `KV cache read failed; live deals were fetched without trusting the cache. (${detailText(warning, "error")})`;
    case "live_refresh_partial":
      return detail(warning, "action") === "served_stale_cache"
        ? "Live refresh was partial; served stale KV cache instead."
        : "Live refresh was partial; results were not cached.";
    case "cache_write_failed":
      return `Cache write failed; live deals are still current for this response. (${detailText(warning, "error")})`;
    case "live_refresh_failed":
      return `Live refresh failed; served stale KV cache. (${detailText(warning, "error")})`;
  }
}

export function formatWeeklyDealWarnings(
  warnings: WeeklyDealWarning[],
): string[] {
  return warnings.map(formatWeeklyDealWarning);
}

/** User-facing warning copy used by the structured app payload. */
export function formatWeeklyDealAppWarning(
  warning: WeeklyDealWarning,
): string | undefined {
  switch (warning.code) {
    case "cache_served":
      return undefined;
    case "cache_read_failed":
      return "Saved deals could not be loaded. Showing current results.";
    case "cache_write_failed":
      return "Current deals loaded, but could not be saved for later.";
    case "live_refresh_failed":
      return `Live refresh failed; served previously saved deals. (${detailText(warning, "error")})`;
    case "live_refresh_partial":
      return detail(warning, "action") === "served_stale_cache"
        ? "Live refresh was partial; served previously saved deals instead."
        : "Live refresh was partial; results were not cached.";
    default:
      return formatWeeklyDealWarning(warning);
  }
}

export function formatWeeklyDealAppWarnings(
  warnings: WeeklyDealWarning[],
): string[] {
  return warnings.flatMap((warning) => {
    const formatted = formatWeeklyDealAppWarning(warning);
    return formatted === undefined ? [] : [formatted];
  });
}

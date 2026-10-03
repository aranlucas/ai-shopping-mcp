/** Per-operation catalog budget, shared by search and list enrichment.
 * Forty exact products fit a normal grocery list while bounding provider work;
 * text search remains capped at ten, with at most five requests in flight.
 */
export const MAX_CATALOG_REQUESTS = 40;

export const MAX_TEXT_TERMS = 10;

export const CATALOG_CONCURRENCY = 5;

/** Preserve the search tool's distinction between names and copied UPCs. */
export function isUpcTerm(term: string): boolean {
  return /^\d{8,13}$/.test(term.trim());
}

export function normalizeProductTerm(term: string): string {
  const trimmed = term.trim();

  return isUpcTerm(trimmed) ? trimmed.padStart(13, "0") : trimmed;
}

/** One shared concurrency limit across mixed exact and text requests. */
export async function mapCatalogRequests<T, R>(
  items: T[],
  resolve: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];

  for (let start = 0; start < items.length; start += CATALOG_CONCURRENCY) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- batches bound concurrent provider requests
    const batch = await Promise.all(
      items
        .slice(start, start + CATALOG_CONCURRENCY)
        .map((item, offset) => resolve(item, start + offset)),
    );

    results.push(...batch);
  }

  return results;
}

import type { components as ProductComponents } from "./kroger/product.js";
import type { Circular, CircularsResponse } from "./kroger/weekly-deals.js";

const QFC_WEEKLY_AD_BASE = "https://www.qfc.com";
const KROGER_DIGITAL_ADS_BASE = "https://api.kroger.com";
const DACS_BASE = "https://oms-kroger-webapp-da-classic-api-prod.przone.net";
const DACS_PUBLIC_API_KEY = "bqwwosbzrzcvffztxzyczieljzsahmkp";
const DEFAULT_QFC_LOCATION_ID = "70500847";

type JsonRecord = Record<string, unknown>;
type KrogerProduct = ProductComponents["schemas"]["products.productModel"];

/**
 * Callback for searching Kroger products via the authenticated Product API.
 * Returns an array of products matching the search term at the given location.
 */
export type ProductSearchFn = (
  term: string,
  locationId: string,
  limit: number,
) => Promise<KrogerProduct[]>;

export interface QfcWeeklyDealsOptions {
  locationId?: string;
  divisionCode?: string;
  limit?: number;
  pageLimit?: number;
  /**
   * Authenticated Kroger Product Search API callback.
   * When provided, deals are sourced from the search API (products with promo
   * pricing) rather than the print-ad fallback.
   */
  searchProducts?: ProductSearchFn;
  signal?: AbortSignal;
}

export interface NormalizedWeeklyDeal {
  id: string;
  title: string;
  details?: string;
  price?: string;
  savings?: string;
  loyalty?: string;
  department?: string;
  validFrom?: string;
  validTill?: string;
  disclaimer?: string;
  imageUrl?: string;
  source: "search_api" | "print";
  rawType?: string;
}

export interface QfcDealsApiResponse {
  sourceMode: "search_api" | "print_fallback";
  locationId: string;
  divisionCode: string;
  shoppableCircular?: Circular;
  printCircular?: Circular;
  warnings: string[];
  deals: NormalizedWeeklyDeal[];
  meta?: {
    termCount?: number;
    pageCount?: number;
    augmentedCount?: number;
  };
}

interface DacsListingResponse {
  pages?: Array<{
    eventPageId?: string;
    page?: string;
  }>;
  adId?: string;
  adTitle?: string;
  startDate?: string;
  endDate?: string;
}

interface DacsPageResponse {
  eventPageId?: string;
  contents?: Array<{
    contentType?: string;
    mapConfig?: string;
  }>;
}

interface ParsedDacsOffer {
  id: string;
  title: string;
  details?: string;
  imageUrl?: string;
}

function getDefaultLocationId(locationId?: string): string {
  return locationId || DEFAULT_QFC_LOCATION_ID;
}

function inferDivisionCode(locationId: string, explicit?: string): string {
  if (explicit) return explicit;
  return locationId.slice(0, 3);
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function formatPrice(value: number | null | undefined, uom?: string | null): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "";
  const price = value >= 1 ? `$${value.toFixed(2)}` : `${Math.round(value * 100)}¢`;
  return uom ? `${price}/${uom}` : price;
}

async function fetchJson<T>(
  url: string,
  init?: RequestInit,
): Promise<{ data: T; response: Response }> {
  const response = await fetch(url, init);
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Invalid JSON from ${url} (status ${response.status}): ${text.slice(0, 200)}`);
  }

  if (!response.ok) {
    const errorText =
      typeof parsed === "object" && parsed && "errors" in (parsed as JsonRecord)
        ? JSON.stringify((parsed as JsonRecord).errors)
        : JSON.stringify(parsed).slice(0, 400);
    throw new Error(`HTTP ${response.status} for ${url}: ${errorText}`);
  }

  return { data: parsed as T, response };
}

async function fetchQfcWeeklyCirculars(params: {
  divisionCode: string;
  signal?: AbortSignal;
}): Promise<Circular[]> {
  const url = new URL("/digitalads/v1/circulars", KROGER_DIGITAL_ADS_BASE);
  url.searchParams.append("filter.tags", "SHOPPABLE");
  url.searchParams.append("filter.tags", "CLASSIC_VIEW");
  url.searchParams.append("filter.div", params.divisionCode);

  const { data } = await fetchJson<CircularsResponse>(url.toString(), {
    headers: { accept: "application/json", "user-agent": "Mozilla/5.0" },
    signal: params.signal,
  });

  return data.data || [];
}

function selectCurrentCirculars(circulars: Circular[]) {
  const now = Date.now();
  const active = circulars.filter((c) => {
    const start = Date.parse(c.eventStartDate);
    const end = Date.parse(c.eventEndDate);
    return Number.isFinite(start) && Number.isFinite(end) && start <= now && now <= end;
  });

  const shoppable =
    active.find((c) => c.circularType === "weeklyAd" && c.tags.includes("SHOPPABLE")) ||
    circulars.find((c) => c.circularType === "weeklyAd" && !c.previewCircular);

  const print =
    active.find((c) => c.circularType === "print" && c.tags.includes("CLASSIC_VIEW")) ||
    circulars.find((c) => c.circularType === "print" && !c.previewCircular);

  return { shoppable, print };
}

// ---------------------------------------------------------------------------
// Kroger Product Search API — deal discovery
// ---------------------------------------------------------------------------

/**
 * Broad grocery category terms used to discover on-sale products via the
 * Kroger Product Search API. We search all categories in parallel and filter
 * for items where price.promo < price.regular.
 */
const DEAL_SEARCH_TERMS = [
  "chicken",
  "beef",
  "milk",
  "bread",
  "frozen",
  "juice",
  "snack",
  "vegetable",
  "seafood",
  "cereal",
] as const;

const PRODUCTS_PER_TERM = 50;

function normalizeProductAsDeal(product: KrogerProduct): NormalizedWeeklyDeal {
  const item = product.items?.[0];
  const promo = item?.price?.promo;
  const regular = item?.price?.regular;

  let price: string | undefined;
  let savings: string | undefined;

  if (typeof promo === "number") {
    price = formatPrice(promo);
    if (typeof regular === "number" && regular > promo) {
      savings = `Save ${formatPrice(regular - promo)} (was ${formatPrice(regular)})`;
    }
  } else if (typeof regular === "number") {
    price = formatPrice(regular);
  }

  const department = product.categories?.[0];
  const title = product.description || "Unknown Product";

  const defaultImage = product.images?.find((img) => img.default) || product.images?.[0];
  const imageUrl =
    defaultImage?.sizes?.find((s) => s.size === "medium")?.url || defaultImage?.sizes?.[0]?.url;

  return {
    id: product.productId || product.upc || Math.random().toString(36).slice(2),
    title,
    details: item?.size || undefined,
    price,
    savings,
    department,
    imageUrl,
    source: "search_api",
  };
}

async function fetchDealsBySearchApi(params: {
  locationId: string;
  searchProducts: ProductSearchFn;
  limit?: number;
}): Promise<{ deals: NormalizedWeeklyDeal[]; termCount: number }> {
  const limit = Math.max(1, Math.min(params.limit || 50, 200));

  const searchPromises = DEAL_SEARCH_TERMS.map((term) =>
    params
      .searchProducts(term, params.locationId, PRODUCTS_PER_TERM)
      .catch(() => [] as KrogerProduct[]),
  );

  const results = await Promise.all(searchPromises);
  const allProducts = results.flat();

  // Keep only products with an active promo price below the regular price
  const onSale = allProducts.filter((product) => {
    const item = product.items?.[0];
    const promo = item?.price?.promo;
    const regular = item?.price?.regular;
    return typeof promo === "number" && typeof regular === "number" && promo < regular;
  });

  // Deduplicate by productId / upc
  const seen = new Set<string>();
  const unique = onSale.filter((product) => {
    const id = product.productId || product.upc;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const deals = unique.slice(0, limit).map(normalizeProductAsDeal);
  return { deals, termCount: DEAL_SEARCH_TERMS.length };
}

// ---------------------------------------------------------------------------
// Print-ad fallback (DACS)
// ---------------------------------------------------------------------------

async function fetchPrintAdListing(params: {
  eventId: string;
  locationId: string;
  signal?: AbortSignal;
}): Promise<DacsListingResponse> {
  const url = new URL(`/api/dacs/${params.eventId}`, DACS_BASE);
  url.searchParams.set("location", params.locationId);

  const { data } = await fetchJson<DacsListingResponse>(url.toString(), {
    headers: {
      accept: "*/*",
      "user-agent": "Mozilla/5.0",
      referer: `${QFC_WEEKLY_AD_BASE}/weeklyad`,
      origin: QFC_WEEKLY_AD_BASE,
      xapikey: DACS_PUBLIC_API_KEY,
      "content-type": "application/json",
    },
    signal: params.signal,
  });

  return data;
}

async function fetchPrintAdPage(params: {
  eventId: string;
  eventPageId: string;
  locationId: string;
  signal?: AbortSignal;
}): Promise<DacsPageResponse> {
  const url = new URL(`/api/dacs/${params.eventId}/pages/${params.eventPageId}`, DACS_BASE);
  url.searchParams.set("location", params.locationId);

  const { data } = await fetchJson<DacsPageResponse>(url.toString(), {
    headers: {
      accept: "*/*",
      "user-agent": "Mozilla/5.0",
      referer: `${QFC_WEEKLY_AD_BASE}/weeklyad`,
      origin: QFC_WEEKLY_AD_BASE,
      xapikey: DACS_PUBLIC_API_KEY,
      "content-type": "application/json",
    },
    signal: params.signal,
  });

  return data;
}

function parseDacsOfferFromMapConfig(mapConfig: string): ParsedDacsOffer | null {
  try {
    const parsed = JSON.parse(mapConfig) as JsonRecord;
    const content = parsed.content as JsonRecord | undefined;
    if (!content) return null;

    const id = content.id;
    const title = content.headline;
    if (typeof id !== "number" || typeof title !== "string" || !title.trim()) {
      return null;
    }

    const bodyCopy =
      typeof content.bodyCopy === "string" && content.bodyCopy.trim()
        ? content.bodyCopy
        : undefined;
    const imageURL =
      typeof content.imageURL === "string" && content.imageURL.trim()
        ? content.imageURL
        : undefined;

    return {
      id: String(id),
      title: title.trim(),
      details: bodyCopy,
      imageUrl: imageURL,
    };
  } catch {
    return null;
  }
}

function dedupeDealsById<T extends { id: string }>(deals: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const deal of deals) {
    if (seen.has(deal.id)) continue;
    seen.add(deal.id);
    unique.push(deal);
  }
  return unique;
}

async function normalizePrintDeals(params: {
  printCircular: Circular;
  locationId: string;
  pageLimit?: number;
  limit?: number;
  signal?: AbortSignal;
}): Promise<{ deals: NormalizedWeeklyDeal[]; pageCount: number }> {
  const listing = await fetchPrintAdListing({
    eventId: params.printCircular.eventId,
    locationId: params.locationId,
    signal: params.signal,
  });

  const pages = listing.pages || [];
  const pageLimit = Math.max(1, Math.min(params.pageLimit || 2, 10));
  const limit = Math.max(1, Math.min(params.limit || 50, 200));

  const selectedPages = pages.slice(0, pageLimit);
  const pageResponses = await Promise.all(
    selectedPages.map((page) =>
      page.eventPageId
        ? fetchPrintAdPage({
            eventId: params.printCircular.eventId,
            eventPageId: page.eventPageId,
            locationId: params.locationId,
            signal: params.signal,
          }).catch(() => ({ contents: [] }))
        : Promise.resolve({ contents: [] }),
    ),
  );

  const offers: NormalizedWeeklyDeal[] = [];
  for (const page of pageResponses) {
    for (const content of page.contents || []) {
      if (content.contentType !== "Offer" || !content.mapConfig) continue;
      const parsed = parseDacsOfferFromMapConfig(content.mapConfig);
      if (!parsed) continue;
      offers.push({
        id: parsed.id,
        title: parsed.title,
        details: parsed.details,
        price: "See print ad",
        validFrom: params.printCircular.eventStartDate,
        validTill: params.printCircular.eventEndDate,
        imageUrl: parsed.imageUrl,
        source: "print",
      });
    }
  }

  return {
    deals: dedupeDealsById(offers).slice(0, limit),
    pageCount: selectedPages.length,
  };
}

// ---------------------------------------------------------------------------
// Search API augmentation for print-ad deals
// ---------------------------------------------------------------------------

/**
 * For each print-ad deal, searches the Kroger Product API by deal title and
 * merges real pricing (regular + promo) into the normalized deal. Deals that
 * don't match any product are returned unchanged.
 */
async function augmentPrintDealsWithSearchApi(
  deals: NormalizedWeeklyDeal[],
  searchProducts: ProductSearchFn,
  locationId: string,
): Promise<{ augmented: NormalizedWeeklyDeal[]; augmentedCount: number }> {
  const augmentPromises = deals.map(async (deal) => {
    const products = await searchProducts(deal.title, locationId, 5).catch(
      () => [] as KrogerProduct[],
    );

    // Prefer a product that has a promo price, otherwise take any priced product
    const match =
      products.find((p) => typeof p.items?.[0]?.price?.promo === "number") ||
      products.find((p) => typeof p.items?.[0]?.price?.regular === "number");

    if (!match) return deal;

    const item = match.items?.[0];
    const promo = item?.price?.promo;
    const regular = item?.price?.regular;

    let price: string | undefined;
    let savings: string | undefined;

    if (typeof promo === "number") {
      price = formatPrice(promo);
      if (typeof regular === "number" && regular > promo) {
        savings = `Save ${formatPrice(regular - promo)} (was ${formatPrice(regular)})`;
      }
    } else if (typeof regular === "number") {
      price = formatPrice(regular);
    }

    if (!price) return deal;
    return { ...deal, price, savings };
  });

  const augmented = await Promise.all(augmentPromises);
  const augmentedCount = augmented.filter((d, i) => d.price !== deals[i].price).length;

  return { augmented, augmentedCount };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function getQfcWeeklyDeals(
  options: QfcWeeklyDealsOptions = {},
): Promise<QfcDealsApiResponse> {
  const locationId = getDefaultLocationId(options.locationId);
  const divisionCode = inferDivisionCode(locationId, options.divisionCode);
  const warnings: string[] = [];

  // Fetch circular metadata for date context (no auth required)
  let shoppableCircular: Circular | undefined;
  let printCircular: Circular | undefined;
  try {
    const circulars = await fetchQfcWeeklyCirculars({
      divisionCode,
      signal: options.signal,
    });
    const selected = selectCurrentCirculars(circulars);
    shoppableCircular = selected.shoppable;
    printCircular = selected.print;
  } catch (error) {
    warnings.push(`Unable to fetch weekly circulars for date context: ${safeErrorMessage(error)}`);
  }

  // Primary: print-ad parsing via DACS (no auth required)
  if (printCircular) {
    try {
      const { deals, pageCount } = await normalizePrintDeals({
        printCircular,
        locationId,
        pageLimit: options.pageLimit,
        limit: options.limit,
        signal: options.signal,
      });

      // Augment print deals with real pricing from the Kroger Search API
      let finalDeals = deals;
      let augmentedCount: number | undefined;
      if (options.searchProducts && deals.length > 0) {
        try {
          const result = await augmentPrintDealsWithSearchApi(
            deals,
            options.searchProducts,
            locationId,
          );
          finalDeals = result.augmented;
          augmentedCount = result.augmentedCount;
        } catch (error) {
          warnings.push(`Search API pricing augmentation failed: ${safeErrorMessage(error)}`);
        }
      }

      return {
        sourceMode: "print_fallback",
        locationId,
        divisionCode,
        shoppableCircular,
        printCircular,
        warnings,
        deals: finalDeals,
        meta: { pageCount, augmentedCount },
      };
    } catch (error) {
      warnings.push(
        `Print-ad parsing failed; falling back to search API. (${safeErrorMessage(error)})`,
      );
    }
  }

  // Fallback: Kroger Product Search API (requires auth)
  if (options.searchProducts) {
    try {
      const { deals, termCount } = await fetchDealsBySearchApi({
        locationId,
        searchProducts: options.searchProducts,
        limit: options.limit,
      });

      return {
        sourceMode: "search_api",
        locationId,
        divisionCode,
        shoppableCircular,
        printCircular,
        warnings,
        deals,
        meta: { termCount },
      };
    } catch (error) {
      warnings.push(`Search API deal fetch also failed. (${safeErrorMessage(error)})`);
    }
  }

  throw new Error(
    `Failed to fetch deals from all sources (division ${divisionCode}). ${warnings.join(" ")}`.trim(),
  );
}

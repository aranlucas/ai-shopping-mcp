import { normalizeKrogerPrice } from "./kroger/price.js";
import type * as z from "zod/v4";

import type {
  Circular,
  NormalizedWeeklyDeal,
  ProductSearchProduct,
  QfcDealsApiResponse,
} from "./weekly-deals/schema.js";

import { AppErrorException } from "../errors.js";
import { safeJsonParse } from "../utils/json.js";
import {
  circularsResponseSchema,
  dacsListingResponseSchema,
  dacsMapConfigSchema,
  dacsOfferDetailsSchema,
  dacsPageResponseSchema,
  normalizedWeeklyDealsResultSchema,
  productSearchProductsSchema,
  weeklyDealWarning,
} from "./weekly-deals/schema.js";

export type {
  NormalizedWeeklyDeal,
  QfcDealsApiResponse,
  WeeklyDealWarning,
  WeeklyDealWarningCode,
} from "./weekly-deals/schema.js";

const QFC_WEEKLY_AD_BASE = "https://www.qfc.com";
const KROGER_DIGITAL_ADS_BASE = "https://api.kroger.com";
const DACS_BASE = "https://oms-kroger-webapp-da-classic-api-prod.przone.net";
const DACS_PUBLIC_API_KEY = "bqwwosbzrzcvffztxzyczieljzsahmkp";
const DEFAULT_QFC_LOCATION_ID = "70500847";

type JsonRecord = Record<string, unknown>;
/**
 * Callback for searching Kroger products via the authenticated Product API.
 * Returns an array of products matching the search term at the given location.
 */
export type ProductSearchFn = (
  term: string,
  locationId: string,
  limit: number,
) => Promise<unknown[]>;

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

type DacsListingResponse = z.output<typeof dacsListingResponseSchema>;
type DacsPageResponse = z.output<typeof dacsPageResponseSchema>;
type DacsOfferDetails = z.output<typeof dacsOfferDetailsSchema>;

interface ParsedDacsOffer {
  id: string;
  title: string;
  details?: string;
  imageUrl?: string;
  offerVersionProductGroupId?: string;
}

type DealProduct = ProductSearchProduct;

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

function normalizedResult(
  value: z.input<typeof normalizedWeeklyDealsResultSchema>,
): QfcDealsApiResponse {
  return normalizedWeeklyDealsResultSchema.parse(value);
}

function formatPrice(
  value: number | null | undefined,
  uom?: string | null,
): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "";
  const price =
    value >= 1 ? `$${value.toFixed(2)}` : `${Math.round(value * 100)}¢`;
  return uom ? `${price}/${uom}` : price;
}

async function fetchJson<TSchema extends z.ZodType>(
  url: string,
  schema: TSchema,
  init?: RequestInit,
): Promise<{ data: z.output<TSchema>; response: Response }> {
  const response = await fetch(url, init);
  const text = await response.text();
  const parsed = text
    ? safeJsonParse(text).match(
        (value) => value,
        () => {
          throw new Error(
            `Invalid JSON from ${url} (status ${response.status}): ${text.slice(0, 200)}`,
          );
        },
      )
    : {};

  if (!response.ok) {
    const errorText =
      typeof parsed === "object" && parsed && "errors" in (parsed as JsonRecord)
        ? JSON.stringify((parsed as JsonRecord).errors)
        : JSON.stringify(parsed).slice(0, 400);
    throw new Error(`HTTP ${response.status} for ${url}: ${errorText}`);
  }

  const validated = schema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`Invalid response from ${url}: ${validated.error.message}`);
  }
  return { data: validated.data, response };
}

async function fetchQfcWeeklyCirculars(params: {
  divisionCode: string;
  signal?: AbortSignal;
}): Promise<Circular[]> {
  const url = new URL("/digitalads/v1/circulars", KROGER_DIGITAL_ADS_BASE);
  url.searchParams.append("filter.tags", "SHOPPABLE");
  url.searchParams.append("filter.tags", "CLASSIC_VIEW");
  url.searchParams.append("filter.div", params.divisionCode);

  const { data } = await fetchJson(url.toString(), circularsResponseSchema, {
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
    return (
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      start <= now &&
      now <= end
    );
  });

  const shoppable =
    active.find(
      (c) => c.circularType === "weeklyAd" && c.tags.includes("SHOPPABLE"),
    ) ||
    circulars.find((c) => c.circularType === "weeklyAd" && !c.previewCircular);

  const print =
    active.find(
      (c) => c.circularType === "print" && c.tags.includes("CLASSIC_VIEW"),
    ) ||
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

function productDealPrice(product: DealProduct) {
  const { price, regularPrice } = normalizeKrogerPrice(
    product.items?.[0]?.price,
  );
  return {
    price: price === undefined ? undefined : formatPrice(price),
    savings:
      price !== undefined && regularPrice !== undefined && regularPrice > price
        ? `Save ${formatPrice(regularPrice - price)} (was ${formatPrice(regularPrice)})`
        : undefined,
  };
}

function normalizeProductAsDeal(product: DealProduct): NormalizedWeeklyDeal {
  const item = product.items?.[0];
  const { price, savings } = productDealPrice(product);

  const department = product.categories?.[0];
  const title = product.description || "Unknown Product";

  const defaultImage =
    product.images?.find((img) => img.default) || product.images?.[0];
  const imageUrl =
    defaultImage?.sizes?.find((s) => s.size === "medium")?.url ||
    defaultImage?.sizes?.[0]?.url;

  return {
    id:
      product.productId ||
      product.upc ||
      product.description?.trim().toLowerCase().replace(/\s+/g, "-") ||
      "unknown-product",
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
}): Promise<{
  deals: NormalizedWeeklyDeal[];
  termCount: number;
  failedTermCount: number;
  failures: unknown[];
}> {
  const limit = Math.max(1, Math.min(params.limit || 50, 200));

  const searchPromises = DEAL_SEARCH_TERMS.map((term) =>
    Promise.resolve()
      .then(() =>
        params.searchProducts(term, params.locationId, PRODUCTS_PER_TERM),
      )
      .then(
        (products) => {
          const parsed = productSearchProductsSchema.safeParse(products);
          if (!parsed.success) {
            throw new Error(
              `Invalid product search response: ${parsed.error.message}`,
            );
          }
          return { ok: true as const, products: parsed.data };
        },
        (error: unknown) => ({
          ok: false as const,
          products: [],
          error,
        }),
      ),
  );

  const results = await Promise.all(searchPromises);
  const failures = results.flatMap((result) =>
    result.ok ? [] : [result.error],
  );
  if (failures.length === results.length) {
    const firstFailure = failures[0];
    if (firstFailure instanceof AppErrorException) throw firstFailure;
    throw new Error(
      `All weekly deal searches failed: ${safeErrorMessage(firstFailure)}`,
    );
  }

  const allProducts = results.flatMap((result) => result.products);

  // Keep only products with an active promo price below the regular price
  const onSale = allProducts.filter((product) => {
    const { price, regularPrice } = normalizeKrogerPrice(
      product.items?.[0]?.price,
    );
    return (
      price !== undefined && regularPrice !== undefined && price < regularPrice
    );
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
  return {
    deals,
    termCount: DEAL_SEARCH_TERMS.length,
    failedTermCount: failures.length,
    failures,
  };
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

  const { data } = await fetchJson(url.toString(), dacsListingResponseSchema, {
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
  const url = new URL(
    `/api/dacs/${params.eventId}/pages/${params.eventPageId}`,
    DACS_BASE,
  );
  url.searchParams.set("location", params.locationId);

  const { data } = await fetchJson(url.toString(), dacsPageResponseSchema, {
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

async function fetchPrintAdOfferDetails(params: {
  eventId: string;
  offerVersionProductGroupId: string;
  locationId: string;
  signal?: AbortSignal;
}): Promise<DacsOfferDetails> {
  const url = new URL(
    `/api/dacs/${params.eventId}/offers/${params.offerVersionProductGroupId}`,
    DACS_BASE,
  );
  url.searchParams.set("location", params.locationId);

  const { data } = await fetchJson(url.toString(), dacsOfferDetailsSchema, {
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

function parseDacsOfferFromMapConfig(
  mapConfig: string,
): ParsedDacsOffer | null {
  const parsed = safeJsonParse(mapConfig).match(
    (value) => dacsMapConfigSchema.safeParse(value),
    () => null,
  );
  if (!parsed || !parsed.success) return null;

  const { content } = parsed.data;
  const title = content.headline.trim();
  if (!title) return null;

  const bodyCopy =
    typeof content.bodyCopy === "string" && content.bodyCopy.trim()
      ? content.bodyCopy
      : undefined;
  const imageURL =
    typeof content.imageURL === "string" && content.imageURL.trim()
      ? content.imageURL
      : undefined;

  return {
    id: String(content.id),
    title,
    details: bodyCopy,
    imageUrl: imageURL,
    offerVersionProductGroupId:
      content.offerVersionProductGroupId === undefined
        ? undefined
        : String(content.offerVersionProductGroupId),
  };
}

function normalizeDacsText(
  value: string | null | undefined,
): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function applyDacsOfferDetails(
  deal: NormalizedWeeklyDeal,
  offer: DacsOfferDetails,
): NormalizedWeeklyDeal {
  const bodyCopy = normalizeDacsText(offer.bodyCopy);
  const disclaimer = normalizeDacsText(offer.disclaimer);
  const details = [bodyCopy, disclaimer].filter((value): value is string =>
    Boolean(value),
  );
  const pricingText = normalizeDacsText(offer.pricingText);

  return {
    ...deal,
    details: details.length > 0 ? details.join(" • ") : deal.details,
    price: pricingText || deal.price,
    validFrom: offer.startDate || deal.validFrom,
    validTill: offer.endDate || deal.validTill,
    imageUrl: offer.imageURL || deal.imageUrl,
    rawType: offer.isShoppable ? "shoppable" : deal.rawType,
  };
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
}): Promise<{
  deals: NormalizedWeeklyDeal[];
  pageCount: number;
  failedPageCount: number;
}> {
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
    selectedPages.map(async (page) => {
      if (!page.eventPageId) return { contents: [], error: undefined };
      try {
        const response = await fetchPrintAdPage({
          eventId: params.printCircular.eventId,
          eventPageId: page.eventPageId,
          locationId: params.locationId,
          signal: params.signal,
        });
        return { contents: response.contents ?? [], error: undefined };
      } catch (error) {
        return { contents: [], error };
      }
    }),
  );

  const failedPageCount = pageResponses.filter(
    (page) => page.error !== undefined,
  ).length;
  if (selectedPages.length > 0 && failedPageCount === selectedPages.length) {
    const firstFailure = pageResponses.find(
      (page) => page.error !== undefined,
    )?.error;
    throw new Error(
      `All print-ad pages failed: ${safeErrorMessage(firstFailure)}`,
    );
  }

  const parsedOffers: ParsedDacsOffer[] = [];
  for (const page of pageResponses) {
    for (const content of page.contents || []) {
      if (content.contentType !== "Offer" || !content.mapConfig) continue;
      const parsed = parseDacsOfferFromMapConfig(content.mapConfig);
      if (!parsed) continue;
      parsedOffers.push(parsed);
    }
  }

  const selectedOffers = dedupeDealsById(parsedOffers).slice(0, limit);
  const offers = await Promise.all(
    selectedOffers.map(async (parsed): Promise<NormalizedWeeklyDeal> => {
      const deal: NormalizedWeeklyDeal = {
        id: parsed.id,
        title: parsed.title,
        details: parsed.details,
        price: "See print ad",
        validFrom: params.printCircular.eventStartDate,
        validTill: params.printCircular.eventEndDate,
        imageUrl: parsed.imageUrl,
        source: "print",
      };

      if (!parsed.offerVersionProductGroupId) return deal;

      try {
        const offer = await fetchPrintAdOfferDetails({
          eventId: params.printCircular.eventId,
          offerVersionProductGroupId: parsed.offerVersionProductGroupId,
          locationId: params.locationId,
          signal: params.signal,
        });
        return applyDacsOfferDetails(deal, offer);
      } catch {
        // Offer details are enrichment; keep the page-level deal if one offer
        // request is unavailable or malformed.
        return deal;
      }
    }),
  );

  if (failedPageCount > 0 && offers.length === 0) {
    throw new Error(
      `Print-ad pages partially failed and returned no offers (${failedPageCount}/${selectedPages.length} failed).`,
    );
  }

  return { deals: offers, pageCount: selectedPages.length, failedPageCount };
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
    const rawProducts = await searchProducts(deal.title, locationId, 5).catch(
      () => [] as unknown[],
    );
    const parsedProducts = productSearchProductsSchema.safeParse(rawProducts);
    const products = parsedProducts.success ? parsedProducts.data : [];

    // Prefer a product that has a promo price, otherwise take any priced product
    const match =
      products.find(
        (p) =>
          normalizeKrogerPrice(p.items?.[0]?.price).regularPrice !== undefined,
      ) ||
      products.find(
        (p) => normalizeKrogerPrice(p.items?.[0]?.price).price !== undefined,
      );

    if (!match) return deal;

    const { price, savings } = productDealPrice(match);

    if (!price) return deal;
    return { ...deal, price, savings };
  });

  const augmented = await Promise.all(augmentPromises);
  const augmentedCount = augmented.filter(
    (d, i) => d.price !== deals[i].price,
  ).length;

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
  const warnings: QfcDealsApiResponse["warnings"] = [];

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
    warnings.push(
      weeklyDealWarning("circular_fetch_failed", {
        error: safeErrorMessage(error),
      }),
    );
  }

  // Primary: print-ad parsing via DACS (no auth required)
  if (printCircular) {
    try {
      const { deals, pageCount, failedPageCount } = await normalizePrintDeals({
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
          warnings.push(
            weeklyDealWarning("search_augmentation_failed", {
              error: safeErrorMessage(error),
            }),
          );
        }
      }

      if (failedPageCount > 0) {
        warnings.push(
          weeklyDealWarning("print_ad_partial", {
            failedPages: failedPageCount,
            totalPages: pageCount,
          }),
        );
      }

      return normalizedResult({
        sourceMode: "print_fallback",
        locationId,
        divisionCode,
        shoppableCircular,
        printCircular,
        warnings,
        deals: finalDeals,
        meta: {
          pageCount,
          augmentedCount,
          ...(failedPageCount > 0 ? { degraded: true } : {}),
        },
      });
    } catch (error) {
      warnings.push(
        weeklyDealWarning("print_ad_failed", {
          error: safeErrorMessage(error),
        }),
      );
    }
  }

  // Fallback: Kroger Product Search API (requires auth)
  if (options.searchProducts) {
    try {
      const { deals, termCount, failedTermCount, failures } =
        await fetchDealsBySearchApi({
          locationId,
          searchProducts: options.searchProducts,
          limit: options.limit,
        });

      if (failedTermCount > 0) {
        warnings.push(
          weeklyDealWarning("search_partial", {
            failedTerms: failedTermCount,
            totalTerms: termCount,
          }),
        );
      }

      return normalizedResult({
        sourceMode: "search_api",
        locationId,
        divisionCode,
        shoppableCircular,
        printCircular,
        warnings,
        deals,
        meta: {
          termCount,
          ...(failedTermCount > 0 ? { degraded: true, failedTermCount } : {}),
          ...(failures.length > 0
            ? {
                failureMessages: failures
                  .map((failure) => safeErrorMessage(failure))
                  .slice(0, 3),
              }
            : {}),
        },
      });
    } catch (error) {
      warnings.push(
        weeklyDealWarning("search_failed", {
          error: safeErrorMessage(error),
        }),
      );
      if (error instanceof AppErrorException) {
        throw new AppErrorException({
          ...error.appError,
          message: error.appError.message,
        });
      }
      throw new Error(
        `Failed to fetch deals from all sources (division ${divisionCode}). ${safeErrorMessage(error)}`.trim(),
        { cause: error },
      );
    }
  }

  throw new Error(
    `Failed to fetch deals from all sources (division ${divisionCode}).`.trim(),
  );
}

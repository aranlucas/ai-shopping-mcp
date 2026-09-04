/**
 * Client for the public Trader Joe's product catalog.
 *
 * Trader Joe's publishes no partner API, and — unlike Kroger — it has no cart
 * or checkout API at all: the storefront is browse-only. What it does expose is
 * an unauthenticated Magento GraphQL endpoint at
 * `https://www.traderjoes.com/api/graphql`, the same one the website itself
 * calls, answering catalog queries scoped to a store code. This module speaks
 * only that read-only surface. Anything past a shopping list — cart, checkout,
 * delivery — stays Kroger-only, because Trader Joe's has no such API.
 *
 * Two properties of that endpoint shape the design:
 *
 * - It is undocumented and unversioned. Responses are parsed through Zod and a
 *   schema change surfaces as a normal `AppError`, never a thrown exception.
 * - It sits behind Akamai bot management, which rejects some server egress
 *   addresses outright. Requests therefore carry the storefront's own browser
 *   headers (not a credential — they contain no user data), and the endpoint is
 *   overridable through `TRADER_JOES_GRAPHQL_URL` so an allowed egress proxy
 *   can be swapped in without a code change.
 */
import { ClientError, GraphQLClient } from "graphql-request";
import { ResultAsync, err, ok, okAsync } from "neverthrow";
import * as z from "zod/v4";

import type { AppError } from "../../errors.js";
import type { KvLike } from "../../utils/kv.js";

import { apiError, networkError } from "../../errors.js";

/** Storefront GraphQL endpoint used when no override is configured. */
export const TRADER_JOES_ENDPOINT = "https://www.traderjoes.com/api/graphql";

/**
 * Store the catalog is priced against when the caller names none. Trader Joe's
 * pricing is near-uniform nationally, so one default keeps cache entries shared
 * across shoppers instead of fragmenting per store.
 */
export const TRADER_JOES_DEFAULT_STORE_CODE = "701";

const CACHE_PREFIX = "tj:search:v1";
const CACHE_TTL_SECONDS = 1800;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_QUERY_LENGTH = 120;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 12;

/**
 * Mirrors the storefront's own fetch so Akamai bot management does not reject
 * the call. No credential and no user data — just the shape of a browser
 * request.
 */
const STOREFRONT_HEADERS = {
  accept: "*/*",
  "accept-language": "en-US,en;q=0.9",
  origin: "https://www.traderjoes.com",
  referer: "https://www.traderjoes.com/home/search",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
} as const;

export type TraderJoesProduct = {
  sku: string;
  name: string;
  price?: number;
  size?: string;
  category?: string;
  imageUrl?: string;
  url?: string;
  available: boolean;
};

export type TraderJoesSearchResult = {
  storeCode: string;
  products: TraderJoesProduct[];
};

export type TraderJoesClient = {
  searchProducts(
    query: string,
    options?: { storeCode?: string; limit?: number },
  ): ResultAsync<TraderJoesSearchResult, AppError>;
};

/**
 * The storefront's own product query, trimmed to the fields a shopping list
 * needs. Field names are Magento's and must match the upstream schema exactly.
 */
const SEARCH_PRODUCTS = /* GraphQL */ `
  query SearchProducts(
    $search: String
    $pageSize: Int
    $currentPage: Int
    $storeCode: String
    $availability: String = "1"
    $published: String = "1"
  ) {
    products(
      search: $search
      filter: {
        store_code: { eq: $storeCode }
        published: { eq: $published }
        availability: { match: $availability }
      }
      pageSize: $pageSize
      currentPage: $currentPage
    ) {
      items {
        sku
        item_title
        sales_size
        sales_uom_description
        primary_image
        url_key
        availability
        retail_price
        category_hierarchy {
          name
        }
        price_range {
          minimum_price {
            final_price {
              value
            }
          }
        }
      }
    }
  }
`;

type SearchVariables = {
  search: string;
  storeCode: string;
  pageSize: number;
  currentPage: number;
};

const nullableString = z.string().nullish();
const nullableNumber = z.number().nullish();

const catalogItemSchema = z.object({
  sku: nullableString,
  item_title: nullableString,
  sales_size: nullableNumber,
  sales_uom_description: nullableString,
  primary_image: nullableString,
  url_key: nullableString,
  availability: nullableString,
  retail_price: nullableString,
  category_hierarchy: z.array(z.object({ name: nullableString })).nullish(),
  price_range: z
    .object({
      minimum_price: z
        .object({ final_price: z.object({ value: nullableNumber }).nullish() })
        .nullish(),
    })
    .nullish(),
});

const searchDataSchema = z.object({
  products: z.object({ items: z.array(catalogItemSchema).nullish() }).nullish(),
});

const cachedResultSchema = z.object({
  storeCode: z.string(),
  products: z.array(
    z.object({
      sku: z.string(),
      name: z.string(),
      price: z.number().optional(),
      size: z.string().optional(),
      category: z.string().optional(),
      imageUrl: z.string().optional(),
      url: z.string().optional(),
      available: z.boolean(),
    }),
  ),
});

type CatalogItem = z.output<typeof catalogItemSchema>;

/** Clamps a caller-supplied limit into the range the storefront answers well. */
function boundedLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

/**
 * Prefers `price_range`, which is a number, and falls back to `retail_price`,
 * which the storefront returns as a decimal string.
 */
function itemPrice(item: CatalogItem): number | undefined {
  const ranged = item.price_range?.minimum_price?.final_price?.value;
  if (typeof ranged === "number" && ranged > 0) return ranged;

  const retail = item.retail_price?.trim().replace(/^\$/u, "");
  if (!retail) return undefined;
  const parsed = Number.parseFloat(retail);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Joins the numeric pack size with its unit description — 12 and "Ounce"
 * becomes "12 Ounce". Either half may be missing upstream.
 */
function itemSize(item: CatalogItem): string | undefined {
  const unit = item.sales_uom_description?.trim();
  const size = item.sales_size;
  if (typeof size !== "number" || size <= 0) return unit || undefined;
  return unit ? `${size} ${unit}` : String(size);
}

/**
 * Takes the most specific hierarchy entry, skipping the generic storefront root
 * the catalog puts first.
 */
function itemCategory(item: CatalogItem): string | undefined {
  const hierarchy = item.category_hierarchy ?? [];
  for (let index = hierarchy.length - 1; index >= 0; index -= 1) {
    const name = hierarchy[index]?.name?.trim();
    if (name && name.toLowerCase() !== "products") return name;
  }
  return undefined;
}

function absoluteUrl(path: string | null | undefined): string | undefined {
  const trimmed = path?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("/")) return `https://www.traderjoes.com${trimmed}`;
  return `https://www.traderjoes.com/${trimmed}`;
}

function toProduct(item: CatalogItem): TraderJoesProduct | null {
  const sku = item.sku?.trim();
  const name = item.item_title?.trim();
  if (!sku || !name) return null;

  const price = itemPrice(item);
  const size = itemSize(item);
  const category = itemCategory(item);
  const imageUrl = absoluteUrl(item.primary_image);
  const urlKey = item.url_key?.trim().replace(/^\/+|\/+$/gu, "");

  return {
    sku,
    name,
    ...(price === undefined ? {} : { price }),
    ...(size === undefined ? {} : { size }),
    ...(category === undefined ? {} : { category }),
    ...(imageUrl === undefined ? {} : { imageUrl }),
    ...(urlKey ? { url: `https://www.traderjoes.com/home/products/pdp/${urlKey}` } : {}),
    available: (item.availability ?? "1").trim() !== "0",
  };
}

function cacheKey(query: string, storeCode: string, limit: number): string {
  return `${CACHE_PREFIX}:${storeCode}:${limit}:${query.toLowerCase()}`;
}

/** A cache miss, a malformed entry, and a KV outage are all just "no cache". */
function readCache(
  kv: KvLike | null,
  key: string,
): ResultAsync<TraderJoesSearchResult | null, never> {
  if (!kv) return okAsync(null);
  return ResultAsync.fromPromise(kv.get(key), () => undefined)
    .orElse(() => okAsync(null))
    .map((raw) => {
      if (typeof raw !== "string") return null;
      try {
        return cachedResultSchema.parse(JSON.parse(raw)) satisfies TraderJoesSearchResult;
      } catch {
        return null;
      }
    });
}

function writeCache(kv: KvLike | null, key: string, result: TraderJoesSearchResult): void {
  if (!kv) return;
  // Caching is an optimization: a write failure must never fail the search.
  void Promise.resolve(
    kv.put(key, JSON.stringify(result), { expirationTtl: CACHE_TTL_SECONDS }),
  ).catch(() => undefined);
}

/**
 * Turns a graphql-request failure into an AppError.
 *
 * `ClientError` covers both a non-2xx response and a 200 carrying GraphQL
 * `errors`, so the HTTP status is what separates "blocked" from "bad query".
 */
function toCatalogError(cause: unknown): AppError {
  if (cause instanceof ClientError) {
    const status = cause.response.status;
    const graphQLMessage = cause.response.errors?.[0]?.message;
    if (status === 403) {
      // Almost always bot management rejecting this egress address rather than
      // a bad query, so say that instead of implying the terms were wrong.
      return apiError("Trader Joe's blocked this request (bot protection).", undefined, status);
    }
    if (graphQLMessage) {
      return apiError(`Trader Joe's catalog rejected the query: ${graphQLMessage}`);
    }
    return apiError(`Trader Joe's returned HTTP ${status}.`, undefined, status);
  }
  return networkError(
    `Could not reach the Trader Joe's catalog: ${cause instanceof Error ? cause.message : String(cause)}`,
    cause,
  );
}

export type TraderJoesClientOptions = {
  endpoint?: string;
  storeCode?: string;
  kv?: KvLike | null;
  fetcher?: typeof globalThis.fetch;
};

export function createTraderJoesClient(options: TraderJoesClientOptions = {}): TraderJoesClient {
  const endpoint = options.endpoint?.trim() || TRADER_JOES_ENDPOINT;
  const defaultStoreCode = options.storeCode?.trim() || TRADER_JOES_DEFAULT_STORE_CODE;
  const kv = options.kv ?? null;

  const graphQL = new GraphQLClient(endpoint, {
    headers: STOREFRONT_HEADERS,
    ...(options.fetcher ? { fetch: options.fetcher } : {}),
  });

  function fetchProducts(
    query: string,
    storeCode: string,
    limit: number,
  ): ResultAsync<TraderJoesProduct[], AppError> {
    const variables: SearchVariables = {
      search: query,
      storeCode,
      pageSize: limit,
      currentPage: 1,
    };

    return ResultAsync.fromPromise(
      graphQL.request<unknown, SearchVariables>({
        document: SEARCH_PRODUCTS,
        variables,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }),
      toCatalogError,
    ).andThen((data) => {
      const parsed = searchDataSchema.safeParse(data);
      if (!parsed.success) {
        return err(apiError("Trader Joe's catalog response did not match the expected shape."));
      }
      const items = parsed.data.products?.items ?? [];
      const products: TraderJoesProduct[] = [];
      for (const item of items) {
        if (products.length === limit) break;
        const product = toProduct(item);
        if (product) products.push(product);
      }
      return ok(products);
    });
  }

  return {
    searchProducts(query, searchOptions) {
      const trimmed = query.trim().slice(0, MAX_QUERY_LENGTH);
      if (!trimmed) {
        return okAsync(undefined).andThen(() =>
          err<TraderJoesSearchResult, AppError>(
            apiError("A Trader Joe's search needs search terms."),
          ),
        );
      }
      const storeCode = searchOptions?.storeCode?.trim() || defaultStoreCode;
      const limit = boundedLimit(searchOptions?.limit);
      const key = cacheKey(trimmed, storeCode, limit);

      return readCache(kv, key).andThen((cached) => {
        if (cached) return okAsync<TraderJoesSearchResult, AppError>(cached);
        return fetchProducts(trimmed, storeCode, limit).map((products) => {
          const result: TraderJoesSearchResult = { storeCode, products };
          writeCache(kv, key, result);
          return result;
        });
      });
    },
  };
}

/**
 * Kroger product search, shared by the product search tool, the
 * `search_products` MCP App payload, and `shop_for_items`. Those three need the
 * full Kroger records for product selection and presentation.
 */
import type { AppError } from "../../errors.js";
import type { KrogerClients } from "./client.js";
import type { components as ProductComponents, operations } from "./product.js";

import { validationError } from "../../errors.js";
import { fromApiResponse } from "../../utils/result.js";

import { MAX_TEXT_TERMS, mapCatalogRequests } from "./catalog-workload.js";

type Product = ProductComponents["schemas"]["products.productModel"];

export type ProductSearchRequest = {
  requestId: string;
  term: string;
};

export type ProductSearchSuccess = ProductSearchRequest & {
  status: "success";
  products: Product[];
};

export type ProductSearchFailure = ProductSearchRequest & {
  status: "failed";
  error: AppError;
};

export type ProductSearchResult = ProductSearchSuccess | ProductSearchFailure;

/**
 * Searches Kroger products for each term in parallel. Shared by `search_products`
 * and `shop_for_items` so both tools use the same query shape, sorting, and
 * error handling.
 */
/** Kroger's `filter.term` limits (kroger/product.json). */
const MIN_TERM_CHARS = 3;

const MAX_TERM_WORDS = 8;

/** Trims a term to Kroger's word limit; longer terms are rejected upstream. */
function toKrogerTerm(term: string): string {
  return term.trim().split(/\s+/).slice(0, MAX_TERM_WORDS).join(" ");
}

export async function searchProductsForTerms(
  productClient: KrogerClients["productClient"],
  requests: ProductSearchRequest[],
  params: { locationId?: string; limitPerTerm: number },
  onSearchComplete?: (completed: number, total: number) => Promise<void> | void,
): Promise<ProductSearchResult[]> {
  if (requests.length > MAX_TEXT_TERMS) {
    return requests.map((request) => ({
      ...request,
      status: "failed" as const,
      error: validationError(
        `Maximum ${MAX_TEXT_TERMS} text search terms per call.`,
      ),
    }));
  }

  let completedSearches = 0;
  const totalSearches = requests.length;

  const results = await mapCatalogRequests(requests, async (request) => {
    const term = toKrogerTerm(request.term);

    if (term.length < MIN_TERM_CHARS) {
      completedSearches++;

      return {
        ...request,
        status: "failed" as const,
        error: validationError(
          `"${request.term}" is too short; Kroger needs at least ${MIN_TERM_CHARS} characters. Search by the full product name.`,
        ),
      };
    }

    const queryParams: operations["productGet"]["parameters"]["query"] = {
      "filter.term": term,
      "filter.fulfillment": "ais",
      "filter.limit": params.limitPerTerm,
    };

    if (params.locationId) queryParams["filter.locationId"] = params.locationId;

    const apiResult = await fromApiResponse(
      () =>
        productClient.GET("/v1/products", {
          params: { query: queryParams },
        }),
      `search products for "${request.term}"`,
    );

    completedSearches++;

    if (onSearchComplete) {
      try {
        await onSearchComplete(completedSearches, totalSearches);
      } catch (cause) {
        console.warn("Search progress notification failed:", cause);
      }
    }

    // Preserve Result type — map Ok to success shape, log and convert Err
    return apiResult
      .map((data) => {
        const products = (data?.data || []).filter((product) =>
          Boolean(product.upc?.trim()),
        );

        return Object.assign(
          {
            status: "success" as const,
            products,
          },
          request,
        );
      })
      .orTee((error) => logProductSearchError(request.term, error))
      .match(
        (result) => result,
        (error) => ({ ...request, status: "failed" as const, error }),
      );
  });

  for (const result of results) {
    if (result.status === "success" && result.products.length > 0) {
      result.products.sort((a, b) => {
        const aItem = a.items?.[0];
        const bItem = b.items?.[0];
        const aPickup = aItem?.fulfillment?.curbside === true;
        const bPickup = bItem?.fulfillment?.curbside === true;

        if (aPickup && !bPickup) return -1;

        if (!aPickup && bPickup) return 1;

        return 0;
      });
    }
  }

  return results;
}

export function logProductSearchError(term: string, error: AppError) {
  if (error.type === "AUTH_ERROR") {
    console.warn(`Search unavailable for "${term}":`, error.message);

    return;
  }

  console.error(`Error searching products for "${term}":`, error.message);
}

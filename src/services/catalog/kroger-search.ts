/**
 * Kroger product search, shared by the Kroger catalog provider, the
 * `search_products` MCP App payload, and `shop_for_items`. Those three need the
 * full Kroger records, not the provider-agnostic projection, so this stays
 * Kroger-shaped on purpose.
 */
import type { AppError } from "../../errors.js";
import type { KrogerClients } from "../kroger/client.js";
import type { components as ProductComponents } from "../kroger/product.js";

import { fromApiResponse } from "../../utils/result.js";

type Product = ProductComponents["schemas"]["products.productModel"];

export type ProductSearchResult = {
  term: string;
  products: Product[];
  count: number;
  failed: boolean;
};

/**
 * Searches Kroger products for each term in parallel. Shared by `search_products`
 * and `shop_for_items` so both tools use the same query shape, sorting, and
 * error handling.
 */
export async function searchProductsForTerms(
  productClient: KrogerClients["productClient"],
  terms: string[],
  params: { locationId?: string; limitPerTerm: number },
  onSearchComplete?: (completed: number, total: number) => Promise<void> | void,
): Promise<ProductSearchResult[]> {
  let completedSearches = 0;
  const totalSearches = terms.length;

  const searchPromises = terms.map(async (term) => {
    const queryParams: Record<string, string | number> = {
      "filter.term": term,
      ...(params.locationId ? { "filter.locationId": params.locationId } : {}),
      "filter.fulfillment": "ais",
      "filter.limit": params.limitPerTerm,
    };

    const apiResult = await fromApiResponse(
      productClient.GET("/v1/products", {
        params: { query: queryParams },
      }),
      `search products for "${term}"`,
    );

    completedSearches++;
    if (onSearchComplete) await onSearchComplete(completedSearches, totalSearches);

    // Preserve Result type — map Ok to success shape, log and convert Err
    return apiResult
      .map((data) => {
        const products = data?.data || [];
        return {
          term,
          products,
          count: products.length,
          failed: false as const,
        };
      })
      .orTee((error) => logProductSearchError(term, error))
      .match(
        (result) => result,
        () => ({
          term,
          products: [] as Product[],
          count: 0,
          failed: true as const,
        }),
      );
  });

  const results = await Promise.all(searchPromises);

  for (const result of results) {
    if (!result.failed && result.count > 0) {
      result.products.sort((a, b) => {
        const aItem = a.items?.[0];
        const bItem = b.items?.[0];
        const aPickup = aItem?.fulfillment?.curbside || aItem?.fulfillment?.instore;
        const bPickup = bItem?.fulfillment?.curbside || bItem?.fulfillment?.instore;

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

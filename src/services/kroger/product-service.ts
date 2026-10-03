import { type Result, type ResultAsync, err, ok } from "neverthrow";

import type { AppError } from "../../errors.js";
import type { KrogerClients } from "./client.js";
import type { components as ProductComponents } from "./product.js";

import { notFoundError, validationError } from "../../errors.js";
import { fromApiResponse } from "../../utils/result.js";

import {
  MAX_CATALOG_REQUESTS,
  MAX_TEXT_TERMS,
  isUpcTerm,
  normalizeProductTerm,
  mapCatalogRequests,
} from "./catalog-workload.js";
import { searchProductsForTerms, type ProductSearchResult } from "./search.js";

type Product = ProductComponents["schemas"]["products.productModel"];

/**
 * Owns normalized, ordered product resolution and bounded enrichment. Provider
 * records and partial failures stay intact so comparison and purchase callers
 * can keep their different availability policies. The client owns KV caching.
 */
export class ProductService {
  constructor(private productClient: KrogerClients["productClient"]) {}

  getProduct(upc: string, locationId?: string): ResultAsync<Product, AppError> {
    const queryParams: Record<string, string> = {};

    if (locationId) {
      queryParams["filter.locationId"] = locationId;
    }

    return fromApiResponse(
      () =>
        this.productClient.GET("/v1/products/{id}", {
          params: { path: { id: upc }, query: queryParams },
        }),
      "get product details",
    ).andThen((data) => {
      const product = data?.data;

      if (!product) {
        return err(notFoundError(`No information found for UPC: ${upc}`));
      }

      return ok(product);
    });
  }

  /** Reject excess work before any provider calls; deduplicate after normalizing. */
  async resolveProducts(
    terms: string[],
    params: { locationId?: string; limitPerTerm: number },
    onComplete?: (completed: number, total: number) => Promise<void> | void,
  ): Promise<
    Result<{ results: ProductSearchResult[]; exactUpcs: Set<string> }, AppError>
  > {
    if (terms.length > MAX_CATALOG_REQUESTS) {
      return err(
        validationError(
          `Maximum ${MAX_CATALOG_REQUESTS} product requests per call. Split the request into smaller batches.`,
        ),
      );
    }

    const normalized = terms.map(normalizeProductTerm);

    if (normalized.filter((term) => !isUpcTerm(term)).length > MAX_TEXT_TERMS) {
      return err(
        validationError(
          `Maximum ${MAX_TEXT_TERMS} text search terms per call.`,
        ),
      );
    }

    const uniqueTerms = [...new Set(normalized)];
    const exactUpcs = new Set(uniqueTerms.filter(isUpcTerm));
    let completed = 0;

    const results = await mapCatalogRequests(
      uniqueTerms,
      async (term, index) => {
        const request = { requestId: `product_${index}`, term };
        let result: ProductSearchResult;

        if (exactUpcs.has(term)) {
          result = (await this.getProduct(term, params.locationId)).match(
            (product) => ({
              ...request,
              status: "success" as const,
              products: [product],
            }),
            (error) => ({ ...request, status: "failed" as const, error }),
          );
        } else {
          [result] = await searchProductsForTerms(
            this.productClient,
            [request],
            params,
          );
        }

        completed++;

        try {
          await onComplete?.(completed, uniqueTerms.length);
        } catch (cause) {
          console.warn("Search progress notification failed:", cause);
        }

        return result;
      },
    );

    return ok({ results, exactUpcs });
  }

  /** Aligned names, with null for unavailable products; duplicates use one lookup. */
  async enrichProductNames(
    upcs: string[],
    locationId?: string,
  ): Promise<Result<Array<string | null>, AppError>> {
    const normalized = upcs.map((upc) => upc.trim().padStart(13, "0"));

    const resolved = await this.resolveProducts(normalized, {
      locationId,
      limitPerTerm: 1,
    });

    return resolved.map(({ results }) => {
      const names = new Map(
        results.map((result) => [
          result.term,
          result.status === "success"
            ? (result.products[0]?.description ?? null)
            : null,
        ]),
      );

      return normalized.map((upc) => names.get(upc) ?? null);
    });
  }

  async enrichProductName(
    upc: string,
    locationId?: string,
  ): Promise<string | null> {
    return this.getProduct(upc, locationId).match(
      (product) => product.description ?? null,
      () => null,
    );
  }
}

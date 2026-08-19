import { err, ok, ResultAsync } from "neverthrow";

import type { TraderJoesClient, TraderJoesProduct } from "../traderjoes/client.js";
import type {
  CatalogProduct,
  CatalogGetOptions,
  CatalogProvider,
  CatalogSearchOptions,
  CatalogSearchResult,
} from "./types.js";

import { notFoundError } from "../../errors.js";

function toCatalogProduct(product: TraderJoesProduct): CatalogProduct {
  return {
    ref: {
      provider: "trader_joes",
      // Trader Joe's SKUs are theirs alone — they are not UPCs and mean nothing
      // to any other provider.
      id: product.sku,
    },
    name: product.name,
    ...(product.price === undefined ? {} : { price: product.price }),
    ...(product.size === undefined ? {} : { size: product.size }),
    ...(product.category === undefined ? {} : { category: product.category }),
    ...(product.imageUrl === undefined ? {} : { imageUrl: product.imageUrl }),
    ...(product.url === undefined ? {} : { url: product.url }),
    available: product.available,
  };
}

/**
 * Trader Joe's as a catalog provider: search and exact product reads.
 *
 * `capabilities.cart` is false because Trader Joe's publishes no cart or
 * checkout API — not because it is unimplemented here. Callers use that flag to
 * keep these products off cart paths.
 */
export function createTraderJoesCatalogProvider(client: TraderJoesClient): CatalogProvider {
  return {
    id: "trader_joes",
    label: "Trader Joe's",
    capabilities: { cart: false, aisleLocation: false },
    search(terms: string[], options: CatalogSearchOptions) {
      // One search per term, in parallel. A term that fails is marked failed
      // rather than failing the batch — one bad term must not lose the rest,
      // and one provider being down must not lose the other's results.
      return ResultAsync.fromSafePromise(
        Promise.all(
          terms.map(async (term): Promise<CatalogSearchResult> => {
            const result = await client.searchProducts(term, {
              limit: options.limitPerTerm,
              ...(options.storeId === undefined ? {} : { storeCode: options.storeId }),
            });
            return result
              .map((value) => ({
                provider: "trader_joes" as const,
                term,
                products: value.products.map(toCatalogProduct),
                failed: false,
              }))
              .orTee((error) =>
                console.warn(`Trader Joe's search failed for "${term}":`, error.message),
              )
              .unwrapOr({
                provider: "trader_joes" as const,
                term,
                products: [],
                failed: true,
              });
          }),
        ),
      );
    },
    get(reference, options: CatalogGetOptions) {
      return client
        .searchProducts(reference.id, {
          limit: 10,
          ...(options.storeId === undefined ? {} : { storeCode: options.storeId }),
        })
        .andThen((result) => {
          const product = result.products.find((candidate) => candidate.sku === reference.id);
          return product
            ? ok(toCatalogProduct(product))
            : err(
                notFoundError(
                  `No Trader Joe's product found for productRef=trader_joes:${reference.id}`,
                ),
              );
        });
    },
  };
}

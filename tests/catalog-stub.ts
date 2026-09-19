import { errAsync, ResultAsync, okAsync } from "neverthrow";

import type { AppError } from "../src/errors.js";
import type {
  CatalogProduct,
  CatalogProvider,
  CatalogRegistry,
  CatalogSearchResult,
} from "../src/services/catalog/types.js";

import { notFoundError } from "../src/errors.js";

/**
 * A catalog provider that answers from a fixed product list, for tests that
 * need search results without a network. Pass an error to exercise the
 * degraded path.
 */
export function stubCatalogProvider(
  overrides: Partial<CatalogProvider> & {
    products?: CatalogProduct[];
    error?: AppError;
  } = {},
): CatalogProvider {
  const { products = [], error, ...rest } = overrides;
  const id = rest.id ?? "sample_catalog";
  return {
    id,
    label: rest.label ?? "Sample Catalog",
    capabilities: rest.capabilities ?? { cart: false, aisleLocation: false },
    search:
      rest.search ??
      ((requests) =>
        error
          ? ResultAsync.fromSafePromise(Promise.resolve()).andThen(() =>
              ResultAsync.fromPromise(Promise.reject(error), () => error),
            )
          : okAsync(
              requests.map((request): CatalogSearchResult => ({
                provider: id,
                requestId: request.requestId,
                term: request.term,
                status: "success",
                products,
              })),
            )),
    get:
      rest.get ??
      ((reference) => {
        const product = products.find(
          (candidate) =>
            candidate.ref.provider === reference.provider &&
            candidate.ref.id === reference.id,
        );
        return product
          ? okAsync(product)
          : errAsync(
              notFoundError(
                `No product found for ${reference.provider}:${reference.id}`,
              ),
            );
      }),
  };
}

/** The production registry shape, with no products unless overridden. */
export function stubCatalogRegistry(
  overrides: Partial<CatalogRegistry> = {},
): CatalogRegistry {
  return {
    kroger: stubCatalogProvider({
      id: "kroger",
      label: "Kroger",
      capabilities: { cart: true, aisleLocation: true },
    }),
    ...overrides,
  };
}

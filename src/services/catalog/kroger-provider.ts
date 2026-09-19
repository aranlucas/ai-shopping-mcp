import { networkError } from "../../errors.js";
import { ResultAsync } from "neverthrow";

import type { components as ProductComponents } from "../kroger/product.js";
import type { KrogerClients } from "../kroger/client.js";
import type {
  CatalogAisle,
  CatalogGetOptions,
  CatalogProduct,
  CatalogProvider,
  CatalogSearchOptions,
  CatalogSearchResult,
} from "./types.js";

import { searchProductsForTerms } from "./kroger-search.js";
import { ProductService } from "../kroger/product-service.js";

type Product = ProductComponents["schemas"]["products.productModel"];

function toAisle(product: Product): CatalogAisle | undefined {
  const location = product.aisleLocations?.[0];
  if (!location) return undefined;
  return {
    description: location.description,
    number: location.number,
    sequenceNumber: location.sequenceNumber,
    bayNumber: location.bayNumber,
    side: location.side,
    shelfNumber: location.shelfNumber,
    shelfPositionInBay: location.shelfPositionInBay,
  };
}

function toImageUrl(product: Product): string | undefined {
  const images = (product.images ?? []).map((image) => {
    const sizes = image.sizes?.filter((size) => size.url) ?? [];
    const url =
      sizes.find((size) => size.size === "thumbnail")?.url ??
      sizes.find((size) => size.size === "small")?.url ??
      sizes[0]?.url;
    return { default: image.default, perspective: image.perspective, url };
  });

  return (
    images.find((image) => image.default && image.url)?.url ??
    images.find((image) => image.perspective === "front" && image.url)?.url ??
    images.find((image) => image.url)?.url
  );
}

export function toCatalogProduct(product: Product): CatalogProduct {
  const item = product.items?.[0];
  const regular = item?.price?.regular;
  const promo = item?.price?.promo;
  // Kroger reports promo as 0 when none is running, so a promo only counts when
  // it is positive and actually differs from the shelf price.
  const hasPromo = promo != null && promo > 0 && promo !== regular;
  const price = hasPromo ? promo : (regular ?? undefined);

  return {
    ref: { provider: "kroger", id: product.upc ?? "" },
    name: product.description ?? "Unknown product",
    brand: product.brand,
    price,
    regularPrice: hasPromo ? regular : undefined,
    size: item?.size,
    category: product.categories?.[0],
    imageUrl: toImageUrl(product),
    aisle: toAisle(product),
    // Missing stock data is not evidence that a listed product is unavailable.
    available: item?.inventory?.stockLevel !== "TEMPORARILY_OUT_OF_STOCK",
    pickup: item?.fulfillment?.curbside === true,
  };
}

/**
 * Kroger as a catalog provider.
 *
 * This wraps the existing Kroger product search rather than replacing it:
 * `shop_for_items` still needs full Kroger records, so that explicitly
 * Kroger-only path calls `searchProductsForTerms` while universal tools use
 * this provider projection.
 */
export function createKrogerCatalogProvider(
  productClient: KrogerClients["productClient"],
): CatalogProvider {
  const products = new ProductService(productClient);
  return {
    id: "kroger",
    label: "Kroger",
    capabilities: { cart: true, aisleLocation: true },
    search(terms: string[], options: CatalogSearchOptions) {
      return ResultAsync.fromPromise(
        searchProductsForTerms(
          productClient,
          terms,
          {
            limitPerTerm: options.limitPerTerm,
            locationId: options.storeId,
          },
          options.onTermComplete,
        ),
        (cause) => networkError("Kroger search could not be completed.", cause),
      ).map((results): CatalogSearchResult[] =>
        results.map((result) => ({
          provider: "kroger" as const,
          term: result.term,
          products: result.products.map(toCatalogProduct),
          failed: result.failed,
          error: result.error,
        })),
      );
    },
    get(reference, options: CatalogGetOptions) {
      return products
        .getProduct(reference.id, options.storeId)
        .map(toCatalogProduct);
    },
  };
}

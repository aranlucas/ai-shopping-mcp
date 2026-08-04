import { ResultAsync } from "neverthrow";

import type { components as ProductComponents } from "../kroger/product.js";
import type { KrogerClients } from "../kroger/client.js";
import type {
  CatalogAisle,
  CatalogProduct,
  CatalogProvider,
  CatalogSearchOptions,
  CatalogSearchResult,
} from "./types.js";

import { searchProductsForTerms } from "./kroger-search.js";

type Product = ProductComponents["schemas"]["products.productModel"];

function toAisle(product: Product): CatalogAisle | undefined {
  const location = product.aisleLocations?.[0];
  if (!location) return undefined;
  return {
    ...(location.description === undefined ? {} : { description: location.description }),
    ...(location.number === undefined ? {} : { number: location.number }),
    ...(location.sequenceNumber === undefined ? {} : { sequenceNumber: location.sequenceNumber }),
    ...(location.bayNumber === undefined ? {} : { bayNumber: location.bayNumber }),
    ...(location.side === undefined ? {} : { side: location.side }),
    ...(location.shelfNumber === undefined ? {} : { shelfNumber: location.shelfNumber }),
    ...(location.shelfPositionInBay === undefined
      ? {}
      : { shelfPositionInBay: location.shelfPositionInBay }),
  };
}

export function toCatalogProduct(product: Product): CatalogProduct {
  const item = product.items?.[0];
  const regular = item?.price?.regular;
  const promo = item?.price?.promo;
  // Kroger reports promo as 0 when none is running, so a promo only counts when
  // it is positive and actually differs from the shelf price.
  const hasPromo = promo != null && promo > 0 && promo !== regular;
  const price = hasPromo ? promo : (regular ?? undefined);
  const aisle = toAisle(product);

  return {
    provider: "kroger",
    id: product.upc ?? "",
    name: product.description ?? "Unknown product",
    ...(product.brand === undefined ? {} : { brand: product.brand }),
    ...(price === undefined ? {} : { price }),
    ...(hasPromo && regular != null ? { regularPrice: regular } : {}),
    ...(item?.size === undefined ? {} : { size: item.size }),
    ...(product.categories?.[0] === undefined ? {} : { category: product.categories[0] }),
    ...(aisle === undefined ? {} : { aisle }),
    // Kroger's search filter already restricts to items sold at the store, so
    // presence in the response is availability.
    available: true,
    pickup: Boolean(item?.fulfillment?.curbside || item?.fulfillment?.instore),
    // Carried for the Kroger MCP App views, which render the full record.
    native: product,
  };
}

/**
 * Kroger as a catalog provider.
 *
 * This wraps the existing Kroger product search rather than replacing it:
 * `shop_for_items` and the MCP App views still need the full Kroger records,
 * so those paths keep calling `searchProductsForTerms` directly while the
 * provider-agnostic tool surface goes through here.
 */
export function createKrogerCatalogProvider(
  productClient: KrogerClients["productClient"],
): CatalogProvider {
  return {
    id: "kroger",
    label: "Kroger",
    identifierLabel: "upc",
    capabilities: { cart: true, aisleLocation: true },
    search(terms: string[], options: CatalogSearchOptions) {
      return ResultAsync.fromSafePromise(
        searchProductsForTerms(
          productClient,
          terms,
          {
            limitPerTerm: options.limitPerTerm,
            ...(options.storeId === undefined ? {} : { locationId: options.storeId }),
          },
          options.onTermComplete,
        ),
      ).map((results): CatalogSearchResult[] =>
        results.map((result) => ({
          provider: "kroger" as const,
          term: result.term,
          products: result.products.map(toCatalogProduct),
          failed: result.failed,
        })),
      );
    },
  };
}

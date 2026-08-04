/**
 * Provider-agnostic product catalog.
 *
 * The shopping tools speak this vocabulary, not any one retailer's. A provider
 * is anything that can answer "what products match these words" — Kroger's REST
 * product API, Trader Joe's GraphQL storefront, and whatever comes next. Adding
 * one means implementing `CatalogProvider` and registering it; no tool changes.
 *
 * The one thing the abstraction refuses to hide is what a match can *do*.
 * Kroger products carry a UPC and can be put in a cart; Trader Joe's publishes
 * no cart API at all, so its products can only reach a shopping list. That
 * difference drives real behavior, so `capabilities.cart` is part of the
 * contract and every result carries the provider it came from.
 */
import type { ResultAsync } from "neverthrow";

import type { AppError } from "../../errors.js";

/** Stable provider keys. These appear in tool input, so they are part of the wire contract. */
export const CATALOG_PROVIDER_IDS = ["kroger", "trader_joes"] as const;

export type CatalogProviderId = (typeof CATALOG_PROVIDER_IDS)[number];

/** Where an item sits in a store, when the provider knows. */
export type CatalogAisle = {
  description?: string;
  number?: string;
  sequenceNumber?: string;
  bayNumber?: string;
  side?: string;
  shelfNumber?: string;
  shelfPositionInBay?: string;
};

/**
 * One product, normalized across providers.
 *
 * `id` is provider-scoped and only meaningful to its own provider: a Kroger UPC
 * and a Trader Joe's SKU are not interchangeable, and nothing should treat them
 * as a shared key.
 */
export type CatalogProduct = {
  provider: CatalogProviderId;
  id: string;
  name: string;
  brand?: string;
  /** Current price, promotional if one is running. */
  price?: number;
  /** Undiscounted price, present only when `price` is a promotional one. */
  regularPrice?: number;
  size?: string;
  category?: string;
  imageUrl?: string;
  url?: string;
  available: boolean;
  /** True when the provider offers pickup for this item. */
  pickup?: boolean;
  aisle?: CatalogAisle;
  /**
   * The provider's own untouched record.
   *
   * Deliberately opaque: it exists for surfaces that are already bound to one
   * provider's shape — the Kroger MCP App views — and must not be read by
   * provider-agnostic code, which would defeat the point of this projection.
   */
  native?: unknown;
};

/** Matches from one provider for one search term. */
export type CatalogSearchResult = {
  provider: CatalogProviderId;
  term: string;
  products: CatalogProduct[];
  /** The provider could not answer for this term. Other providers may still have. */
  failed: boolean;
};

export type CatalogSearchOptions = {
  limitPerTerm: number;
  /** Provider-scoped store identifier, when the caller named one. */
  storeId?: string;
  /** Ask for shelf-location detail. Providers that have none ignore it. */
  includeLocation?: boolean;
  /** Reports progress as terms complete, for providers that search serially per term. */
  onTermComplete?: (completed: number, total: number) => Promise<void> | void;
};

/** What a provider can do beyond search. */
export type CatalogCapabilities = {
  /** Products can be added to a cart and bought. False for browse-only catalogs. */
  cart: boolean;
  /** Products carry shelf-location detail. */
  aisleLocation: boolean;
};

export interface CatalogProvider {
  readonly id: CatalogProviderId;
  /** Human name used in tool output, e.g. "Trader Joe's". */
  readonly label: string;
  readonly capabilities: CatalogCapabilities;
  search(
    terms: string[],
    options: CatalogSearchOptions,
  ): ResultAsync<CatalogSearchResult[], AppError>;
}

/** The providers available to a request, keyed by id. */
export type CatalogRegistry = Readonly<Record<CatalogProviderId, CatalogProvider>>;

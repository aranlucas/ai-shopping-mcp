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

export type CatalogProviderId = string;

/** Provider-scoped product identity used by every shared tool and API. */
export type ProductReference = {
  provider: CatalogProviderId;
  id: string;
};

/** Copyable small-model form of ProductReference. Splits only on the first colon. */
export function formatProductReference(reference: ProductReference): string {
  return `${reference.provider}:${reference.id}`;
}

export function parseProductReference(value: string): ProductReference | null {
  const separator = value.indexOf(":");
  if (separator <= 0) return null;
  const provider = value.slice(0, separator).trim();
  const id = value.slice(separator + 1).trim();
  if (!/^[a-z][a-z0-9_]{0,63}$/u.test(provider) || id.length === 0 || id.length > 255) {
    return null;
  }
  return { provider, id };
}

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
 * `ref.id` is provider-scoped and only meaningful with `ref.provider`.
 */
export type CatalogProduct = {
  ref: ProductReference;
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

export type CatalogGetOptions = {
  /** Provider-scoped store identifier, when the caller named one. */
  storeId?: string;
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
  /** Load one exact provider-scoped product reference. */
  get(
    reference: ProductReference,
    options: CatalogGetOptions,
  ): ResultAsync<CatalogProduct, AppError>;
}

/** The providers available to a request, keyed by id. This is intentionally open-ended. */
export type CatalogRegistry = Readonly<Record<string, CatalogProvider>>;

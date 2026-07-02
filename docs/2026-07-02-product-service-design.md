# Kroger Client KV Caching, ProductService, and Enriched Shopping List Design

**Date:** 2026-07-02
**Status:** Proposed

## Overview

Two changes, implemented together:

1. A generic KV-cache middleware applied to the Kroger `productClient` and `locationClient`, mirroring the structure of the existing auth middleware in `src/services/kroger/client.ts`. This is the primary mechanism for limiting external Kroger API calls — caching happens transparently at the HTTP client layer, not per-endpoint.
2. Simplify `create_shopping_list` by removing the product name/notes from item input. Items are `{ upc, quantity, notes }` only — the display name is enriched from a thin `ProductService` wrapper around the (now-cached) `productClient`.

There is no need for backward compatibility.

## Motivation

**Caching.** Kroger's product-search API has a 10,000/day quota. Multiple tools (`search_products`, `get_product`, `shop_for_items`, `get_weekly_deals`, the `shopping://product/{upc}` resource) call the same product/location endpoints repeatedly within a session. `product.ts` already grew a bespoke per-term KV cache for this; that pattern doesn't generalize and duplicates itself every time a new cacheable endpoint shows up. A cache middleware applied once at client-construction time, the same way `createKrogerAuthMiddleware` is applied, covers every current and future GET call through `productClient`/`locationClient` with no per-call-site caching code.

**Shopping list input.** `create_shopping_list` requires `productName` (1-200 chars) on every item today. This forces the model to supply a display name that's either redundant (copied from `search_products` output) or made up. The product name is already available from the Kroger API via the UPC the model must supply anyway for cart checkout. Removing the name from input eliminates token waste, a source of model confusion (what goes in `productName` vs search terms?), and a validation surface area.

## Changes

### 1. Generic KV-cache middleware

**File:** `src/services/kroger/client.ts`

A new middleware factory, structured like `createKrogerAuthMiddleware` right above it:

```typescript
export function createKrogerCacheMiddleware(kv: KvLike | null, ttlSeconds: number): Middleware {
  return {
    async onRequest({ request }) {
      if (!kv || request.method !== "GET") return;
      const cached = await kv.get(cacheKeyFor(request.url));
      if (!cached) return;
      return responseFromCacheEntry(cached); // reconstructs a Response, or undefined if malformed
    },
    async onResponse({ request, response }) {
      if (!kv || request.method !== "GET" || !response.ok) return;
      const entry = await cacheEntryFromResponse(response); // clones, reads body/status/headers
      await kv.put(cacheKeyFor(request.url), entry, { expirationTtl: ttlSeconds });
    },
  };
}
```

**Cache key:** the literal request URL (already includes query params, since openapi-fetch resolves those before invoking middleware), prefixed with a version tag, e.g. `` `kroger-cache|v1|${request.url}` ``.

**Cache entry:** `{ status: number, headers: Record<string, string>, body: string }`, JSON-encoded. Reconstructed into a `Response` on hit.

**Behavior:**

- Only `GET` requests are ever read from or written to cache. Mutations (`cartClient.PUT`) always pass through.
- Only `response.ok` (2xx) responses are cached — failed lookups are retried, never cached.
- A KV read/write failure is non-fatal: falls through to a live request (miss) or is logged and swallowed (write failure), matching the existing `writeProductSearchCache`/`writeWeeklyDealsCache` non-fatal pattern.
- TTL is a flat 600 seconds (matching the existing `PRODUCT_SEARCH_CACHE_TTL_SECONDS`), passed in at construction.

**Not applied to `cartClient`/`identityClient`.** The cache has no per-user scoping — it's keyed purely by request URL, which is correct for product/location data (not user-specific, so sharing the cache across users is the whole point) but would be a data leak for `identityClient` (`profile.compact`) or any future cart-read endpoint, since those responses are user-specific but the request URL likely isn't. `cartClient` currently only issues a `PUT`, so the `GET`-only guard already excludes it in practice; `identityClient` has no GET usage today. Both are left unwrapped so this stays true if that changes.

### 2. Client wiring

**File:** `src/services/kroger/client.ts`

```typescript
export function createKrogerClients(getTokenInfo: () => KrogerTokenInfo | null, kv: KvLike | null) {
  const authMiddleware = createKrogerAuthMiddleware(getTokenInfo);
  const cacheMiddleware = createKrogerCacheMiddleware(kv, KROGER_CACHE_TTL_SECONDS);
  const base = { baseUrl: "https://api.kroger.com" };

  const cartClient = createClient<CartPaths>(base);
  const identityClient = createClient<IdentityPaths>(base);
  const locationClient = createClient<LocationPaths>(base);
  const productClient = createClient<ProductPaths>(base);

  for (const client of [cartClient, identityClient, locationClient, productClient]) {
    client.use(authMiddleware);
  }
  locationClient.use(cacheMiddleware);
  productClient.use(cacheMiddleware);

  return { cartClient, identityClient, locationClient, productClient };
}
```

**File:** `src/server.ts` — `buildServer` resolves `env.USER_DATA_KV` via the shared KV helper (see below) and passes it to `createKrogerClients`.

### 3. Shared KV helper

**New file:** `src/utils/kv.ts`

Consolidates the `KvLike` type and `isKvLike` guard currently duplicated across `src/tools/weekly-deals.ts`, `src/tools/product.ts`, and `src/tools/item-flags.ts`, plus a `getUserDataKv(env: Env): KvLike | null` resolver. `src/services/kroger/client.ts` needs this type and can't import from `src/tools/*` (wrong layering direction), so it moves to `src/utils/`. `weekly-deals.ts`, `item-flags.ts`, and `shop.ts` (for `rankProductMatches`'s embedding cache) switch to importing from here instead of defining/importing their own copies.

### 4. ProductService

**New file:** `src/services/kroger/product-service.ts`

A thin wrapper around `productClient.GET("/v1/products/{id}")` — no manual caching logic, since caching now happens transparently at the client layer (change 1).

```typescript
export class ProductService {
  constructor(private productClient: KrogerClients["productClient"]) {}

  getProduct(upc: string, locationId?: string): ResultAsync<Product, AppError> {
    // fromApiResponse(this.productClient.GET("/v1/products/{id}", ...), "get product details")
    //   .andThen(...) — not-found → AppError, mirrors get_product's existing logic
  }

  async enrichProductName(upc: string, locationId?: string): Promise<string | null> {
    // best-effort: returns product.description on success, null on any failure
    return this.getProduct(upc, locationId).match(
      (product) => product.description ?? null,
      () => null,
    );
  }
}
```

### 5. ToolContext

**File:** `src/tools/types.ts` — add `productService: ProductService` to `ToolContext`.

**File:** `src/server.ts` — construct once: `const productService = new ProductService(clients.productClient);`, add to `ctx`. This is the DI: a single shared instance built at server-bootstrap time (same lifecycle as `clients`/`storage`), injected instead of each handler constructing its own or reaching for the raw client.

**Callers switched to `ctx.productService.getProduct(...)`:**

- `src/tools/product.ts` — `get_product` handler.
- `src/tools/resources.ts` — `shopping://product/{upc}` resource handler.

### 6. Item Input Schema

**File:** `src/tools/shopping-list.ts` — `createShoppingListInputSchema`:

```typescript
z.object({
  upc: upcSchema.describe("UPC from search_products"),
  quantity: z.coerce.number().min(1).max(999).default(1),
  notes: z.string().max(500).optional().describe("e.g. 'get organic'"),
});
```

The `productName` field is removed entirely. Every item must have a `upc`. Tool description updated to reflect the simpler input.

### 7. Item Enrichment

The handler maps items to `ShoppingListItem[]` by looking up the product name via `ctx.productService`:

```typescript
async ({ name: listName, items }) => {
  const enrichedItems = await Promise.all(
    items.map(async (item) => {
      const productName = await ctx.productService.enrichProductName(item.upc);
      return {
        productName: productName ?? item.upc, // fallback to UPC
        upc: item.upc,
        quantity: item.quantity,
        notes: item.notes,
      };
    }),
  );

  return createShoppingListRecord(
    ctx.storage,
    props.id,
    ctx.getSessionId(),
    listName,
    enrichedItems,
  );
};
```

Enrichment is best-effort: a network error or cache miss yields the UPC as fallback display name, never a failed tool call. Lookups run in parallel.

### 8. Remove the now-redundant per-term product-search cache

**File:** `src/tools/product.ts`

Delete `buildProductSearchCacheKey`, `getProductSearchCacheKv`, `readProductSearchCache`, `writeProductSearchCache`, `productSearchCacheEntrySchema`, `cachedProductSchema`, and `PRODUCT_SEARCH_CACHE_TTL_SECONDS`. The client-level cache (change 1) now covers `/v1/products` search `GET`s transparently — this bespoke cache would just be a second, redundant caching layer for the same requests. `searchProductsForTerms` drops its `kv` param and the cache read/write branch, calling `productClient.GET` directly.

**Known tradeoff:** the old cache key lowercased and trimmed the search term (`term.toLowerCase().trim()`), so `"Milk"` and `"milk"` shared a cache entry. The new URL-keyed cache doesn't normalize the term, so differently-cased searches for the same term are separate cache entries. Accepted in exchange for deleting the duplicate caching implementation.

**File:** `src/tools/shop.ts` — `rankProductMatches` uses a KV handle for an unrelated embedding cache (30-day TTL, hash-keyed). It switches from `getProductSearchCacheKv(ctx)` to the new shared `getUserDataKv(ctx.getEnv())` helper (change 3).

## Downstream Impact

### `add_shopping_list_to_cart`

Unaffected in this pass. `handleListIdCart`'s `withoutUpc` branch is not removed — `ShoppingListItem.upc` can still be `undefined` if a matched Kroger product itself has no `upc` field (see `shop_for_items`'s existing `LineItem` filtering), so the branch isn't fully dead code.

### `shop_for_items`

Unaffected in shape — it already produces `{ name, quantity }` input and maps results to `ShoppingListItem` with both `productName` (from the matched product's description) and `upc`. It benefits from the client-level cache transparently, and its embedding-cache KV lookup moves to the shared helper (change 8).

### Views

`ShoppingListItemData` in `views/shared/types.ts` keeps `productName` — views read it from structured content, which comes from the stored `ShoppingListItem`. No change needed.

### `itemFlagLabels`

Still uses `item.productName` for pantry/deal matching. Since `ShoppingListItem.productName` is now always enriched from the product API, it will be the full product description — this may improve match quality.

## Files Changed

| File                                                   | Change                                                                                                                  |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `src/services/kroger/client.ts`                        | Add `createKrogerCacheMiddleware`; `createKrogerClients` takes `kv`, wires cache middleware to product/location clients |
| `src/services/kroger/product-service.ts`               | New: `ProductService` class                                                                                             |
| `src/utils/kv.ts`                                      | New: shared `KvLike`, `isKvLike`, `getUserDataKv`                                                                       |
| `src/server.ts`                                        | Pass KV into `createKrogerClients`; construct `productService`, add to `ctx`                                            |
| `src/tools/types.ts`                                   | Add `productService` to `ToolContext`                                                                                   |
| `src/tools/shopping-list.ts`                           | Remove `productName`/`name` from item schema; add enrichment in handler                                                 |
| `src/tools/product.ts`                                 | `get_product` uses `ctx.productService`; remove bespoke product-search cache                                            |
| `src/tools/resources.ts`                               | Product resource uses `ctx.productService`                                                                              |
| `src/tools/shop.ts`                                    | Use shared `getUserDataKv` for embedding cache                                                                          |
| `src/tools/weekly-deals.ts`, `src/tools/item-flags.ts` | Import `KvLike`/`isKvLike` from `src/utils/kv.ts` instead of local copies                                               |
| `tests/services/kroger/client.test.ts`                 | Add cache middleware tests                                                                                              |
| `tests/services/kroger/product-service.test.ts`        | New: `ProductService` tests                                                                                             |
| `tests/tools/product.test.ts`                          | Update for `ProductService` usage; remove old cache-specific tests                                                      |
| `tests/tools/storage-backed-tools.test.ts`             | Update test calls to use `upc` without `productName`/`name`                                                             |
| `tests/evals/golden-path.eval.test.ts`                 | Update manual path test                                                                                                 |
| `tests/evals/mcp-agent-contract.test.ts`               | Update tool shape assertions                                                                                            |

## Future Considerations

- `ProductService.enrichProductName` could be reused in `record_order` to auto-populate item names from UPCs.
- If the flat 600s TTL proves wrong for some endpoint (e.g. store details change less often than product prices), the middleware can take a per-path TTL table instead of one flat value — not needed today.
- `search_stores` (list search, many query-param combinations) is left uncached in this pass; it goes through `locationClient` so it already benefits from the same middleware if repeated verbatim, but no attempt is made to normalize/dedupe query variants the way the old product-search cache did for terms.

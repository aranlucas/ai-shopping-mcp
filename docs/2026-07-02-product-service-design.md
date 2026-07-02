# Product Service & Enriched Shopping List Design

**Date:** 2026-07-02
**Status:** Proposed

## Overview

Simplify `create_shopping_list` by removing the product name/notes from item input. Items are `{ upc, quantity }` only — the display name is always enriched from a new `ProductService` wrapper that provides KV-cached access to the Kroger product API.

There is no need for backward compabilities

## Motivation

Currently `create_shopping_list` requires `productName` (1-200 chars) on every item. This forces the model to supply a display name that's either redundant (copied from `search_products` output) or made up. Meanwhile, the product name is already available from the Kroger API via the UPC that the model must supply anyway for cart checkout.

Removing the name from input eliminates token waste, a source of model confusion (what goes in `productName` vs search terms?), and a validation surface area.

## Changes

### 1. Item Input Schema

`src/tools/shopping-list.ts` — `createShoppingListInputSchema`:

```typescript
z.object({
  upc: upcSchema.describe("UPC from search_products"),
  quantity: z.coerce.number().min(1).max(999).default(1),
  notes: z.string().max(500).optional().describe("e.g. 'get organic'"),
});
```

The `name`/`productName` field is removed entirely. Every item must have a `upc`.

Tool description updated to reflect the simpler input.

### 2. Item Enrichment

The handler maps items to `ShoppingListItem[]` by looking up the product name from the API:

```typescript
async ({ name: listName, items }) => {
  const enrichedItems = await Promise.all(
    items.map(async (item) => {
      const productName = await productService.enrichProductName(item.upc);
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

### 3. ProductService Wrapper

**New file:** `src/services/kroger/product-service.ts`

A thin caching wrapper around `productClient.GET("/v1/products/{id}")`.

```typescript
export class ProductService {
  constructor(
    private productClient: KrogerClients["productClient"],
    private kv: KvLike | null,
  )

  getProduct(upc: string, locationId?: string): ResultAsync<Product, AppError>
  enrichProductName(upc: string, locationId?: string): Promise<string | null>
}
```

**Cache behavior:**

- Key format: `product|v1|upc:{upc}|loc:{locationId || "none"}`
- TTL: 600 seconds (matching the existing `PRODUCT_SEARCH_CACHE_TTL_SECONDS` in `product.ts`)
- Cache-only misses: on cache miss, call API, cache on success
- Failed/empty API responses are never cached
- Uses existing `safeJsonParseWithSchema` / `safeJsonParse` utilities

**`enrichProductName`** returns `product.description` from the API response, or `null` on failure.

### 4. ToolContext

No changes to `ToolContext`. `ProductService` is constructed on-demand in the handler:

```typescript
const kv = isKvLike(ctx.getEnv()?.USER_DATA_KV) ? ctx.getEnv().USER_DATA_KV : null;
const productService = new ProductService(ctx.clients.productClient, kv);
```

## Downstream Impact

### `add_shopping_list_to_cart`

All new shopping lists have UPCs on every item, so `handleListIdCart`'s `withoutUpc` branch becomes dead code for new lists. The branch can be removed

### `shop_for_items`

Unaffected. `shop_for_items` uses its own search → match → pick-best flow with `{ name, quantity }` input, then maps results to `ShoppingListItem` with both `productName` (from the matched product's description) and `upc`.

### Views

`ShoppingListItemData` in `views/shared/types.ts` keeps `productName` — views read it from structured content, which comes from the stored `ShoppingListItem`. No change needed.

### `itemFlagLabels`

Still uses `item.productName` for pantry/deal matching. Since `ShoppingListItem.productName` is now always enriched from the product API, it will be the full product description — this may improve match quality.

## Files Changed

| File                                       | Change                                                      |
| ------------------------------------------ | ----------------------------------------------------------- |
| `src/services/kroger/product-service.ts`   | New: ProductService class                                   |
| `src/tools/shopping-list.ts`               | Remove `name` from schema; add enrichment in handler        |
| `src/tools/product.ts`                     | Re-export `getProductSearchCacheKv` type helpers if needed  |
| `tests/tools/storage-backed-tools.test.ts` | Update test calls to use `upc` without `productName`/`name` |
| `tests/evals/golden-path.eval.test.ts`     | Update manual path test                                     |
| `tests/evals/mcp-agent-contract.test.ts`   | Update tool shape assertions                                |

## Future Considerations

- The same `ProductService.enrichProductName` could be reused in `record_order` to auto-populate item names from UPCs.
- If KV caching proves insufficient (e.g., high UPC churn), a shorter TTL or no-cache fallback per call is straightforward.
- The enrichment pattern could extend to other clients (cart, location) but those have no single-key lookup analogue.

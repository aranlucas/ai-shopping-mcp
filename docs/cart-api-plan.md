# Cart API Integration Plan

## Discovery Summary

Three distinct cart API surfaces were discovered through HAR file analysis and endpoint probing.

---

## 1. Kroger Public Cart API

**Base**: `https://api.kroger.com`  
**Auth**: OAuth2 Authorization Code (`cart.basic:write` scope)  
**Spec**: `kroger/cart.json` (currently committed)

| Endpoint       | Method | Works?                                 | Notes                |
| -------------- | ------ | -------------------------------------- | -------------------- |
| `/v1/cart/add` | PUT    | ✅ Used by `add_shopping_list_to_cart` | Returns 204, no body |

Only one endpoint. No cart read capability.

---

## 2. Kroger Partner Cart API

**Base**: `https://api.kroger.com`  
**Auth**: OAuth2 Authorization Code  
**Scopes**: `cart.basic` (read), `cart.basic:rw` (read+write)

| Endpoint                     | Method | Required Scope  | Works With Our Token? |
| ---------------------------- | ------ | --------------- | --------------------- |
| `/v1/carts`                  | GET    | `cart.basic`    | ❌ 403                |
| `/v1/carts`                  | POST   | `cart.basic:rw` | ❌ 403                |
| `/v1/carts/{id}`             | GET    | `cart.basic`    | ✅ **200 — WORKS**    |
| `/v1/carts/{id}`             | PUT    | `cart.basic:rw` | ❌ 403                |
| `/v1/carts/{id}/items`       | POST   | `cart.basic:rw` | ❌ 403                |
| `/v1/carts/{id}/items/{upc}` | PUT    | `cart.basic:rw` | ❌ 403                |
| `/v1/carts/{id}/items/{upc}` | DELETE | `cart.basic:rw` | ❌ 403                |

**Key finding**: `GET /v1/carts/{id}` works with our `cart.basic:write` token. This is part of a broader scope mapping pattern between Kroger's Public and Partner APIs:

**Scope mapping (discovered empirically):**

| Public scope       | Partner equivalent | Reads                   | Writes               |
| ------------------ | ------------------ | ----------------------- | -------------------- |
| `product.compact`  | `product.basic`    | ✅ Full Partner read    | N/A (read-only)      |
| `cart.basic:write` | `cart.basic`       | ✅ `GET /v1/carts/{id}` | N/A (read-only)      |
| `cart.basic:write` | `cart.basic:rw`    | ✅                      | ❌ All mutations 403 |

The `:write` suffix on the Public scope grants **Partner-level read access** but not **Partner-level writes**. Write mutations (`POST`, `PUT`, `DELETE` on cart items) require the explicit `cart.basic:rw` scope available only through a Partner app registration. The same pattern holds for Products: `product.compact` unlocks everything the Partner `product.basic` scope claims to require, including prices, fulfillment, inventory, and aisle locations.

Response shape (`carts.cartPayloadModel`):

```json
{
  "data": {
    "id": "uuid",
    "name": "ACTIVE",
    "items": [
      {
        "upc": "0001111040110",
        "description": "QFC Vitamin D Whole Milk Gallon",
        "quantity": 1,
        "modality": "PICKUP",
        "allowSubstitutes": true,
        "specialInstructions": "",
        "createdDate": "2026-07-02T03:20:48.881Z"
      }
    ],
    "createdDate": "2026-03-06T18:04:07.595Z"
  },
  "meta": {}
}
```

**Limitation**: `GET /v1/carts` (list) 403s, so we can't discover the cart ID. We need to source it elsewhere.

---

## 3. QFC Atlas API

**Base**: `https://www.qfc.com/atlas/v1`  
**Auth**: Kroger OAuth Bearer token (same as Public API, `cart.basic:write` scope)  
**Akamai**: Requires browser-like headers to pass edge protection

| Endpoint      | Method | Requires Browser Headers? | Works?             |
| ------------- | ------ | ------------------------- | ------------------ |
| `/carts`      | GET    | ✅ Yes                    | ✅ **200 — WORKS** |
| `/carts/{id}` | PUT    | ✅ Yes                    | ✅ **200 — WORKS** |

**Auth discovery**: The Atlas API accepts the **same Kroger OAuth Bearer token** from the authorization code flow. No website session cookies needed — just `Authorization: Bearer` + browser-standard headers (sec-ch-_, sec-fetch-_, origin, referer, user-agent).

**Required headers for GET** (to pass Akamai):

```
accept: application/json, text/plain, */*
accept-language: en-US,en;q=0.9
user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ...
authorization: Bearer {kroger_oauth_token}
origin: https://www.qfc.com
referer: https://www.qfc.com/mealassistant
x-kroger-channel: WEB
sec-ch-ua: "Google Chrome";v="149", ...
sec-ch-ua-mobile: ?0
sec-ch-ua-platform: "macOS"
sec-fetch-dest: empty
sec-fetch-mode: cors
sec-fetch-site: same-origin
dnt: 1
priority: u=1, i
```

**POST/PUT additional headers** (from HAR):

```
x-modality: {"type":"PICKUP","locationId":"70500847"}
x-modality-type: PICKUP
x-facility-id: 70500847
x-laf-object: [{...fulfillment options...}]
```

Response shape (`GET /carts`):

```json
{
  "data": {
    "carts": [
      {
        "id": "uuid",
        "profileId": "uuid",
        "type": "ACTIVE",
        "lineItemCount": 10,
        "versionKey": "base64-encoded-timestamp",
        "lineItems": [
          {
            "id": "item-uuid",
            "gtin13": "0001111040110",
            "channel": "WEB",
            "modalityType": "PICKUP",
            "quantity": 1,
            "substitutionPolicy": "SHOPPER_CHOICE",
            "savedForLater": false,
            "created": { "value": "...", "timezone": "UTC" },
            "modified": { "value": "...", "timezone": "UTC" }
          }
        ]
      }
    ]
  }
}
```

Note: Atlas returns `gtin13` (not `upc`) and does **not** include product `description`. It also returns item-level `id`, `channel`, `substitutionPolicy`, `savedForLater`.

---

## Recommended Architecture

**Goal**: `view_cart` tool that returns cart contents with product names.

### Approach: Dual-API

Use both APIs in tandem:

1. **Discover cart ID** via `GET /atlas/v1/carts` (works with OAuth Bearer + browser headers)
2. **Read cart with product names** via `GET /api.kroger.com/v1/carts/{id}` (works with just Bearer, no browser headers)

Or, simpler: **cache the cart ID in KV** after the first `PUT /v1/cart/add` call, then skip step 1.

### Implementation Steps

1. **Update `kroger/cart.json`** — replace the Public spec with the Partner spec (or add Partner endpoints alongside)
2. **Regenerate `src/services/kroger/cart.d.ts`** — run `pnpm generate:cart`
3. **Add Atlas API types** — create `src/services/kroger/atlas-cart.d.ts` for the Atlas response shape
4. **Add `view_cart` tool** in `src/tools/cart.ts`:
   - Schema: `{ cartId?: string }` (optional, defaults to stored/active cart)
   - Calls `GET /v1/carts/{id}` on `api.kroger.com` using the existing `cartClient`
   - Formats response with product names, quantities, modalities
   - Stores cart ID in KV for future calls
5. **Atlas fallback** — if Partner API call fails, fall back to `GET /atlas/v1/carts` with browser headers
6. **Tests** — mirror existing patterns in `tests/tools/cart.test.ts`

### Open Questions

- Does `PUT /v1/cart/add` (existing tool) need to be updated to use `POST /v1/carts/{id}/items` instead? (Probably not — the Public endpoint works and is simpler.)
- Should we add `remove_from_cart` / `update_cart_item` tools? The Partner write endpoints all 403 with our scope, but the Atlas PUT endpoint works for mutations.
- **Would a Partner app registration unlock `cart.basic:rw` scope and eliminate the Atlas dependency entirely?** This is probably the right long-term move if we want write support without browser headers.

### Products API Cross-Reference

The same scope-mapping pattern was confirmed empirically with the Products API:

- **Spec**: Partner Products spec requires `product.basic` scope (or `product.personalized` for personalized data)
- **Our scope**: `product.compact` (Public scope, not even listed in the Partner spec)
- **Works**: Full read access — prices, fulfillment, inventory (`stockLevel`), aisle locations, `filter.brand`, `filter.productId` batch (comma-separated, up to 50), temperature, categories, `soldBy`, `size`, images, nutrition info, taxonomies
- **Blocked**: `favorite` (always `False`), `nationalPrice` (always `null`) — these need `product.personalized` scope

This confirms the pattern is intentional, not a cart-specific quirk. Public `*.compact` and `*.basic:write` scopes are aliases/supersets of Partner `*.basic` for reads, but don't unlock Partner `*.basic:rw` write capabilities.

### Appendix: Partner API Full Spec (for type generation)

The complete Partner Cart API OpenAPI spec was sourced from the Kroger developer portal. Save as `kroger/cart-partner.json` and regenerate types. Key differences from Public spec:

- Uses `cart.basic` and `cart.basic:rw` scopes (vs `cart.basic:write`)
- Cart ID is a UUID string (vs just "the user's cart")
- Items have `allowSubstitutes`, `specialInstructions`, `description` fields
- Responses include product names (`description`)
- Supports `SHIP` modality (in addition to `DELIVERY`, `PICKUP`)

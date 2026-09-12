# Grocery shopping MCP

Cloudflare Worker that exposes authenticated grocery shopping tools over MCP. Product search spans multiple store catalogs; cart, store, and weekly-deal tools are Kroger/QFC-backed. OAuth grants live in the existing `OAUTH_KV` namespace; atomic cart operations live in the `CART_OPERATIONS` Durable Object; legacy cart receipts, the assistant cart mirror, and product/location caches live in `USER_DATA_KV`. Pantry, equipment, orders, preferred stores, and shopping lists are owned by agents-gateway/D1. The Worker also serves one bundled MCP App view shared by tool results.

## Local development

Keep local secrets in `.dev.vars`. `pnpm start` and `pnpm dev` load that file
through Wrangler.

Gateway-backed tools forward the authenticated MCP bearer token. The gateway
validates it against this Worker's `/userinfo` endpoint, so no additional
Worker-to-gateway secret is required.

## Production resources

Deploy from this repository with:

```bash
pnpm build
pnpm exec wrangler deploy
```

Keep the Worker name, KV namespace IDs, and Durable Object migration history in `wrangler.jsonc` stable. Configure these runtime secrets in Cloudflare:

- `KROGER_CLIENT_ID`
- `KROGER_CLIENT_SECRET`
- `COOKIE_ENCRYPTION_KEY`

Register the exact production callback URL with Kroger:

```text
https://ai-meal-planner-mcp.aranlucas.workers.dev/callback
```

The Kroger application must allow `profile.compact`, `cart.basic:write`, and `product.compact`.

## MCP surface

The server exposes 18 tools:

- Stores: `search_stores`, `get_store`, `set_preferred_store`
- Products and deals: `search_products`, `get_product`, `shop_for_items`, `get_weekly_deals`
- Profile and meal context: `add_to_inventory`, `remove_from_inventory`, `get_shopping_profile`, `get_meal_planning_context`
- Lists, cart, and orders: `create_shopping_list`, `get_shopping_list`, `add_shopping_list_items`, `edit_shopping_list_item`, `add_shopping_list_to_cart`, `view_cart`, `record_order`

### Catalog providers

`search_products` is provider-agnostic. It takes a `providers` array and
searches each named catalog concurrently, returning one block per provider under
each search term. A provider is anything implementing `CatalogProvider`
(`src/services/catalog/types.ts`); adding one needs no tool changes.

| provider      | cart | identifier       |
| ------------- | ---- | ---------------- |
| `kroger`      | yes  | UPC              |
| `trader_joes` | no   | Trader Joe's SKU |

Products use provider-scoped `productRef=<provider>:<id>` tokens. Preserve these
references on lists and orders. `capabilities.cart` indicates whether the provider
supports cart writes; Trader Joe's product identifiers must never reach Kroger's cart.
Omitting `providers` searches every registered provider. Search failures retain their
error type and recovery guidance while successful providers remain usable.

### Trader Joe's

Trader Joe's publishes no partner API, and unlike Kroger it has **no cart or
checkout API at all** — the storefront is browse-only. What it does expose is
the unauthenticated Magento GraphQL endpoint the website itself calls
(`https://www.traderjoes.com/api/graphql`), which answers catalog queries scoped
to a store code. The client (`src/services/traderjoes/client.ts`) talks to it
through `graphql-request` and reads nothing else.

The endpoint is undocumented and unversioned, so responses are Zod-validated and
schema drift surfaces as a normal tool error. It also sits behind Akamai bot
management that rejects some server egress addresses with a 403 regardless of
the query — that case is reported distinctly from a bad query. Two optional
Worker vars exist for it:

- `TRADER_JOES_GRAPHQL_URL` — point at an allowed egress proxy if Cloudflare's
  addresses are blocked
- `TRADER_JOES_STORE_CODE` — the store code prices are quoted against (default
  `701`)

Results are cached in `USER_DATA_KV` for 30 minutes, keyed by query, store, and
limit. The catalog holds no user data, so entries are shared across shoppers.

### Editing a list by hand

Lists live in agents-gateway/D1 and are edited through `get_shopping_list` (with
no `listId` it returns every list and its id; with one it returns that list's
items and their `itemId`s), then `add_shopping_list_items` and
`edit_shopping_list_item`. List items accept provider-scoped `productRef` values, legacy Kroger `upc` values,
or plain `productName` entries for unmatched ingredients.

It exposes four workflow prompts:

- `plan_shopping_route`
- `set_preferred_store`
- `shop_recipe_ingredients`
- `plan_meals_from_pantry`

### Planning meals around weekly deals

Pass `includeWeeklyDeals: true` to `get_meal_planning_context` to combine your pantry,
expiring ingredients, equipment, and recent purchases with up to ten QFC/Kroger offers:

```json
{
  "numberOfMeals": 3,
  "mealType": "dinner",
  "dietaryPreferences": "vegetarian",
  "includeWeeklyDeals": true,
  "storeId": "70500847"
}
```

Omit `storeId` to use your preferred Kroger store. This option also works with an
empty pantry, so the assistant can plan meals from sale items and identify everything
you need to buy. The host model still writes the meal plan.

The summary reuses the default `get_weekly_deals` cache and preserves offer prices,
conditions, validity dates, and warnings. Stale ads are explicitly labeled; unavailable
deals leave pantry context usable with recovery guidance. Call `get_weekly_deals` for
more offers, then `search_products` to confirm exact products and current prices before
creating a list. Without `includeWeeklyDeals`, meal planning makes no deal requests.

The primary small-model contract is concise text in `content[0].text`. MCP App routing metadata stays in `_meta`; do not treat `structuredContent` as the reasoning payload.

### Cart outcomes and retries

List-backed cart writes reserve an atomic journal entry before contacting Kroger.
The journal is scoped to the authenticated user and OAuth client. Concurrent calls
for the same list cannot submit twice. Completed operations remain recorded even
if the legacy KV receipt fails; pending operations do not expire into permission
to retry. A lost upstream response is reported as `MUTATION_OUTCOME_UNKNOWN` with
`recovery: "check_cart"`. Check the real Kroger cart before starting a new operation;
the assistant mirror is not proof of the upstream outcome.

For inline cart items, supply a unique `operationId` and reuse it for retries.
Reusing an id with changed items is rejected. Calls without an id remain supported
for compatibility but have no cross-request deduplication key. A new id means a
new intentional cart add. The one-shot `shop_for_items` workflow creates a new list
on every call; retry its cart step using the returned `listId`, not by repeating
the whole workflow.

The `v3` migration adds the SQLite-backed `CartOperations` class. Deploy the code,
binding, and migration together. Retain the old `v1`/`v2` migration history.

Gateway and Kroger requests have a 10-second deadline and inherit HTTP request
cancellation. GET responses with 502/503/504 are retried once after 200ms within
that same deadline, unless the server supplies `Retry-After`. Mutations are never
automatically retried. MCP errors include `structuredContent.error` with `code`,
`message`, and `recovery`; concise text remains the primary model-facing payload.

## Connect a client

Clients with remote MCP and OAuth support can connect directly to:

```text
https://ai-meal-planner-mcp.aranlucas.workers.dev/mcp
```

For a client that still needs a local proxy:

```json
{
  "mcpServers": {
    "kroger-shopping": {
      "command": "pnpm",
      "args": ["dlx", "mcp-remote", "https://ai-meal-planner-mcp.aranlucas.workers.dev/mcp"]
    }
  }
}
```

## MCP App preview

Run `pnpm dev:views` and open `http://127.0.0.1:5173/preview.html` to review the app with
sample data and a simulated host. Switch between shopping lists, products, weekly deals,
stale results, loading, empty, and error states. The **Fail actions** control exercises
retry feedback; the theme selector checks light and dark rendering. Preview actions do not
contact a shopping account. The preview entry is excluded from the production app bundle.

Weekly deals can be filtered by category, and **Find product** opens matching products inside
the app using the deal's store. Shopping-list actions distinguish Kroger matches from unmatched
items and add matched items to the pickup cart. The user completes the purchase in Kroger.

## Validation

```bash
pnpm build
pnpm test
pnpm eval:mcp
pnpm cf-typegen
```

`pnpm lint` runs both the standard rules and a focused type-aware pass via `oxlint-tsgolint`.
Floating Promises (including `void` expressions and `ResultAsync` thenables) and misused async
callbacks fail lint and build. The focused configuration avoids enabling unrelated type-aware
style rules across the repository. Synchronous `Result` consumption, including handling an
`Err` after `await`, still requires review; see the remaining [roadmap](docs/ROADMAP.md).

The live Workers AI reranker check is intentionally separate because it uses Cloudflare credentials and incurs usage:

```bash
pnpm test:reranker:live
```

Locally it uses the active Wrangler login. In CI it requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

# Grocery shopping MCP

Cloudflare Worker that exposes authenticated grocery shopping tools over MCP. Product search spans multiple store catalogs; cart, store, and weekly-deal tools are Kroger/QFC-backed. OAuth grants live in the existing `OAUTH_KV` namespace; cart retry state and the product/location cache live in `USER_DATA_KV`. Pantry, equipment, orders, preferred stores, and shopping lists are owned by agents-gateway/D1. The Worker also serves one bundled MCP App view shared by tool results.

## Local development

Keep local secrets in the monorepo root `.env`. `pnpm start` and `pnpm dev`
load that file through Wrangler's supported `--env-file` option.

Gateway-backed tools forward the authenticated MCP bearer token. The gateway
validates it against this Worker's `/userinfo` endpoint, so no additional
Worker-to-gateway secret is required.

## Production resources

Deploy from this monorepo directory with:

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

| provider           | cart | identifier       |
| ------------------ | ---- | ---------------- |
| `kroger` (default) | yes  | UPC              |
| `trader_joes`      | no   | Trader Joe's SKU |

The one thing the abstraction deliberately does not hide is what a match can
_do_. Kroger's API has no SKU concept at all — it keys products, items, and the
cart route on one 13-digit UPC (`productId`, `upc`, and `itemId` are all
documented as "the UPC"). A Trader Joe's SKU is a Magento catalog key, not a
barcode. So `capabilities.cart` and `identifierLabel` are both part of the
provider contract, and output lines read `kroger upc=` or `trader_joes sku=`
rather than a bare `upc=`. `identifierLabel` is declared per provider rather
than inferred from `capabilities.cart`, because what an identifier is called and
whether it can reach a cart are unrelated facts.

Providers degrade independently: one being unreachable marks its own results
failed and leaves the others intact. The search only errors when nothing was
found anywhere _and_ something failed.

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
`edit_shopping_list_item`. List items take either a Kroger `upc` or a plain
`productName`, which is what lets Trader Joe's products, recipe ingredients, and
free text onto a list alongside Kroger products.

It exposes four workflow prompts:

- `plan_shopping_route`
- `set_preferred_store`
- `shop_recipe_ingredients`
- `plan_meals_from_pantry`

The primary small-model contract is concise text in `content[0].text`. MCP App routing metadata stays in `_meta`; do not treat `structuredContent` as the reasoning payload.

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

## Validation

```bash
pnpm build
pnpm test
pnpm eval:mcp
pnpm cf-typegen
```

The live Workers AI reranker check is intentionally separate because it uses Cloudflare credentials and incurs usage:

```bash
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
# Add the Kroger credentials to .dev.vars.
pnpm dev
```

Locally it uses the active Wrangler login. In CI it requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

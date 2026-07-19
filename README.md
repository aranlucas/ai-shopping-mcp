# Kroger shopping MCP

Cloudflare Worker that exposes authenticated Kroger/QFC shopping tools over MCP. OAuth grants live in the existing `OAUTH_KV` namespace; cart retry state and the product/location cache live in `USER_DATA_KV`. Pantry, equipment, orders, preferred stores, and shopping lists are owned by agents-gateway/D1. The Worker also serves one bundled MCP App view shared by tool results.

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
- `SHOPPING_SERVICE_SECRET` (must match the agents-gateway secret)

Set the gateway credential as a Worker secret, never as a Wrangler variable:

```bash
pnpm exec wrangler secret put SHOPPING_SERVICE_SECRET
```

Register the exact production callback URL with Kroger:

```text
https://ai-meal-planner-mcp.aranlucas.workers.dev/callback
```

The Kroger application must allow `profile.compact`, `cart.basic:write`, and `product.compact`.

## MCP surface

The server exposes 15 tools:

- Stores: `search_stores`, `get_store`, `set_preferred_store`
- Products and deals: `search_products`, `get_product`, `shop_for_items`, `get_weekly_deals`
- Profile and meal context: `add_to_inventory`, `remove_from_inventory`, `get_shopping_profile`, `get_meal_planning_context`
- Lists, cart, and orders: `create_shopping_list`, `add_shopping_list_to_cart`, `view_cart`, `record_order`

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
pnpm exec wrangler types --check
```

The live Workers AI reranker check is intentionally separate because it uses Cloudflare credentials and incurs usage:

```bash
pnpm test:reranker:live
```

Locally it uses the active Wrangler login. In CI it requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

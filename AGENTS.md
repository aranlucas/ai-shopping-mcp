# AGENTS.md

Fix the right way.

This repository is a Cloudflare Worker MCP server for Kroger/QFC shopping workflows. It handles OAuth, Kroger API calls, persistent user data, MCP tools/resources/prompts, and MCP Apps React views.

## Start Here

Run the project checks before making changes unless you are only reading files:

```bash
pnpm install
pnpm build
```

Use targeted tests while iterating, then run the relevant full check before handing work back:

```bash
pnpm test
pnpm exec vitest run path/to/test.ts
pnpm exec vitest run -t "test name"
```

Other useful commands:

```bash
pnpm dev
pnpm deploy
pnpm lint
pnpm build:views
pnpm cf-typegen
pnpm generate:cart
pnpm generate:location
pnpm generate:product
pnpm generate:identity
```

## Non-Negotiable Rules

- Do not use `any` in TypeScript. Use schema types, explicit narrowing, or reusable aliases.
- Use generated OpenAPI schema types directly from `src/services/kroger/*.js`; do not infer types from `openapi-fetch` method return signatures.
- If a change touches views, run `pnpm build:views` or `pnpm build`.

## Architecture Map

Core entry points:

- `src/server.ts`: MCP server factory, OAuth provider configuration, client creation, tool/resource/prompt registration.
- `src/kroger-handler.ts`: Kroger OAuth `/authorize` and `/callback` HTTP handlers.
- `src/workers-oauth-utils.ts`: OAuth approval and client verification helpers.
- `src/prompts.ts`: MCP prompt registrations.
- `src/errors.ts`: `AppError` union and constructors.

Tooling and MCP surface:

- `src/tools/cart.ts`: `add_to_cart`
- `src/tools/location.ts`: `search_locations`, `get_location_details`, `set_preferred_location`
- `src/tools/product.ts`: `search_products`, `get_product_details`
- `src/tools/pantry.ts`: `manage_pantry`
- `src/tools/equipment.ts`: `manage_equipment`
- `src/tools/orders.ts`: `mark_order_placed`
- `src/tools/recipes.ts`: `search_recipes_from_web`, `plan_meals`
- `src/tools/shopping-list.ts`: `manage_shopping_list`, `checkout_shopping_list`
- `src/tools/weekly-deals.ts`: `get_weekly_deals`
- `src/tools/resources.ts`: read-only MCP resources
- `src/tools/types.ts`: shared tool context, auth helpers, response helpers, storage types
- `src/tools/tool-types.ts`: Zod-inferred cross-module tool argument types

Services and utilities:

- `src/services/kroger/client.ts`: creates typed Kroger API clients and auth middleware.
- `src/services/kroger/*.d.ts`: generated OpenAPI types.
- `src/services/qfc-weekly-deals.ts`: QFC weekly deals fetcher and Kroger Product API augmentation.
- `src/utils/result.ts`: `neverthrow` bridge helpers.
- `src/utils/user-storage.ts`: Cloudflare KV-backed user data storage.
- `src/utils/format-response.ts`: user-facing formatting helpers.
- `src/utils/view-resource.ts`: MCP Apps view resource registration.

Views:

- `views/app/`: Vite React app rendered by MCP Apps.
- `views/app/views/`: individual tool result views.
- `views/shared/`: shared UI components.
- `dist/views/`: generated view output from `pnpm build:views`.

## OAuth And Tokens

The app has two OAuth layers:

1. MCP clients authenticate to this server through `@cloudflare/workers-oauth-provider`.
2. This server authenticates to Kroger on behalf of the user.

Kroger refresh tokens are single-use. Once used, they are invalidated and replaced. The only safe refresh path is:

- `tokenExchangeCallback` refreshes expiring Kroger tokens.
- The new Kroger access token and refresh token are persisted to the grant.
- The MCP token TTL is aligned with the Kroger token so refresh happens before expiry.

Do not add refresh behavior to `createKrogerAuthMiddleware`. That middleware should attach authorization headers only.

Props are intentionally split:

- `Props`: `{ id, accessToken, tokenExpiresAt }`; safe runtime access-token props passed to tool execution.
- `GrantProps`: `Props & { refreshToken?, krogerClientId, krogerClientSecret }`; server-side grant data.

Keep Kroger credentials and refresh tokens out of runtime `Props`.

## Kroger API Details

Required Worker environment variables:

- `KROGER_CLIENT_ID`
- `KROGER_CLIENT_SECRET`
- `COOKIE_ENCRYPTION_KEY`
- `USER_DATA_KV`

Registered Kroger redirect URI:

```text
https://ai-meal-planner-mcp.aranlucas.workers.dev/callback
```

Required Kroger scopes:

- `profile.compact`
- `cart.basic:write`
- `product.compact`

Token exchange and token refresh use direct `fetch()` calls with:

- `Content-Type: application/x-www-form-urlencoded`
- `Authorization: Basic ${btoa(`${clientId}:${clientSecret}`)}`
- `URLSearchParams` body parameters for the token endpoint

Kroger IDs have strict formats:

- UPCs are exactly 13 digits.
- Location IDs are exactly 8 characters.

## MCP Design Rules

Tools should follow MCP annotations consistently:

- `readOnlyHint`: true for search/query, false for mutations.
- `destructiveHint`: true for clear/delete capabilities.
- `idempotentHint`: true when repeating the same input has the same effect.
- `openWorldHint`: true for external APIs, false for local-only storage.

Current MCP tools:

- Shopping/products: `add_to_cart`, `search_locations`, `get_location_details`, `search_products`, `get_product_details`, `set_preferred_location`
- User data mutations: `manage_pantry`, `manage_equipment`, `mark_order_placed`
- Shopping list: `manage_shopping_list`, `checkout_shopping_list`
- Recipes/meal planning: `search_recipes_from_web`, `plan_meals`
- Weekly deals: `get_weekly_deals`

Current MCP resources:

- `shopping://user/pantry`
- `shopping://user/equipment`
- `shopping://user/location`
- `shopping://user/orders`
- `shopping://user/shopping-list`
- `shopping://product/{productId}`

MCP Sampling has been removed. `plan_meals` returns structured context for the host model to use; it should not call `createMessage`.

## Data Persistence

User data is stored in Cloudflare KV through `src/utils/user-storage.ts`.

Storage classes:

- `PreferredLocationStorage`
- `PantryStorage`
- `EquipmentStorage`
- `ShoppingListStorage`
- `OrderHistoryStorage`

Storage expectations:

- Namespace keys by user ID: `user:{userId}:{dataType}`.
- Preserve case-insensitive deduplication for pantry, equipment, and shopping-list items.
- Preserve automatic quantity updates for duplicate items.
- Keep order history limited to the 50 most recent orders.
- Prefer existing storage and formatting helpers instead of introducing parallel persistence code.

## TypeScript Patterns

Use OpenAPI schema imports like this:

```typescript
import type { components as ProductComponents } from "./services/kroger/product.js";
import type { components as LocationComponents } from "./services/kroger/location.js";
import type { components as CartComponents } from "./services/kroger/cart.js";

type Product = ProductComponents["schemas"]["products.productModel"];
type Location = LocationComponents["schemas"]["locations.location"];
type CartItem = CartComponents["schemas"]["cart.cartItemModel"];
```

Do not use this pattern:

```typescript
type Product = NonNullable<
  Awaited<ReturnType<typeof productClient.GET<"/v1/products">>>["data"]
>["data"];
```

Prefer inference when TypeScript has enough information, especially for Zod tool-handler parameters, known array callbacks, and `openapi-fetch` response destructuring. Add explicit annotations when inference fails, when writing type guards, or when extracting complex reusable types.

Check generated schemas for exact property names before using API fields. Kroger properties may not match expected camelCase names; for example, use `fulfillment.instore`.

## Error Handling

Newer code should prefer `neverthrow` helpers from `src/utils/result.ts`:

```typescript
import { fromApiResponse, toMcpResponse } from "../utils/result.js";

const result = await fromApiResponse(
  productClient.GET("/v1/products", {
    params: {
      query: {
        /* ... */
      },
    },
  }),
  "search products",
);

return toMcpResponse(result.map((data) => formatProducts(data)));
```

Use `AppError` constructors from `src/errors.ts`; do not construct the union members directly. Older `errorResult(message)` and `textResult(text)` helpers still exist in `src/tools/types.ts`; keep changes consistent with the file you are editing.

## Product Search

`search_products` is intentionally bulk and parallel:

- Accept 1-10 search terms.
- Return up to 10 products per term.
- Execute searches in parallel with `Promise.all()`.
- Send progress notifications after each search completes when the client provided a progress token.
- Do not convert this flow to sequential requests.

## MCP Apps Views

Tool responses can include rich UI by returning `structuredContent` and `_meta.ui.resourceUri`.

Startup registers `ui://shopping-app` through `registerViewResource(ctx, APP_VIEW_URI, "app.html")`. The Vite React app receives tool results through `ontoolresult` and routes by `_view`.

When adding or changing a view:

- Put view-specific code in `views/app/views/`.
- Reuse shared UI from `views/shared/`.
- Keep the structured content shape explicit and aligned with the tool response.
- Run `pnpm build:views` or `pnpm build`.

## MCP Client Connection

Example local proxy configuration:

```json
{
  "mcpServers": {
    "ai-shopping-list": {
      "command": "pnpm",
      "args": ["dlx", "mcp-remote", "https://ai-meal-planner-mcp.aranlucas.workers.dev/sse"]
    }
  }
}
```

## Change Checklist

Before handing back code changes:

1. Run the narrowest relevant test or build while iterating.
2. Run `pnpm build` for TypeScript, Biome, and view compilation when practical.
3. Run `pnpm test` when behavior, storage, OAuth, tools, or utilities changed.
4. Mention any verification you could not run.

## Reference

- Kroger authorization docs: https://developer.kroger.com/reference/api/authorization-endpoints-public
- Reference implementation: https://github.com/CupOfOwls/kroger-mcp

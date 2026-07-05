# AGENTS.md

Fix the right way. No shortcuts, no bump-to-green, no suppressing errors to make checks pass.

This repository is a Cloudflare Worker MCP server for Kroger/QFC shopping workflows. It handles OAuth, Kroger API calls, persistent user data, MCP tools/resources/prompts, and MCP Apps React views. The primary consumer is a **small-context host model** (Haiku-class); most design decisions below exist to keep the tool surface usable by weak models, and evals enforce that contract.

## Start Here

```bash
pnpm install
pnpm build   # oxlint + view build + tsc --noEmit (worker AND views/tsconfig.json)
```

Requires Node >= 24.13 and pnpm (see `packageManager` in package.json). Husky + lint-staged run `oxfmt` and `oxlint --fix` on every commit.

Use targeted tests while iterating, then run the full check before handing work back. Tests live in `tests/`, mirroring `src/`:

```bash
pnpm test                                    # everything, including deterministic evals
pnpm exec vitest run tests/path/to/file.test.ts
pnpm exec vitest run -t "test name"
pnpm eval:mcp                                # just the small-model eval suites
```

Other useful commands:

```bash
pnpm dev            # vite watch + wrangler dev (port 8788), concurrently
pnpm deploy         # build views, then wrangler deploy
pnpm lint           # oxlint (lint:fix to autofix)
pnpm fmt            # oxfmt (fmt:check to verify)
pnpm build:views    # vite build of views/mcp-app.html into dist/views/
pnpm cf-typegen     # regenerate worker-configuration types
pnpm generate:apis  # regenerate Kroger OpenAPI types (or generate:cart|location|product|identity)
```

`src/services/kroger/weekly-deals.d.ts` is hand-maintained — there is no `generate:weekly-deals`; the QFC circular endpoint has no OpenAPI spec.

## Non-Negotiable Rules

- Always run `pnpm test` before handing back any behavioral change, and add tests for every new tool, resource, handler, branch, or bug fix. Work is not complete until the relevant tests exist and pass.
- Do not use `any` in TypeScript. Use schema types, explicit narrowing, or reusable aliases.
- Use generated OpenAPI schema types directly from `src/services/kroger/*.js`; do not infer types from `openapi-fetch` method return signatures.
- If a change touches views, run `pnpm build:views` or `pnpm build`.
- Never add `cartClient` or `identityClient` to the shared Kroger KV response cache — it has no per-user scoping, so caching either would leak one user's data to another (see Caching Layers).
- Token-budget eval failures mean a response format regressed. Recalibrate deliberately with `EVAL_LOG=1` and adjust budgets with justification; never bump numbers until green.
- Best-effort enrichment (match ranking, pantry/deal flags, name enrichment) must never fail or noticeably slow the tool call. Errors, timeouts, and missing bindings degrade to the un-enriched result.

## Architecture Map

Core entry points:

- `src/server.ts`: `buildServer()` factory, stateless `/mcp` handler, `OAuthProvider` configuration, tool/resource/prompt registration.
- `src/kroger-handler.ts`: Kroger OAuth `/authorize` and `/callback` HTTP handlers.
- `src/workers-oauth-utils.ts`: OAuth approval and client verification helpers.
- `src/prompts.ts`: MCP prompt registrations.
- `src/errors.ts`: `AppError` union and constructors.

Tooling and MCP surface (`src/tools/`):

- `cart.ts`: `add_shopping_list_to_cart` (listId or inline items), `view_cart` (live Partner cart read when a cartId is known, KV-mirror fallback)
- `location.ts`: `search_stores`, `get_store`, `set_preferred_store`
- `product.ts`: `search_products`, `get_product`; exports `searchProductsForTerms`
- `shop.ts`: `shop_for_items` (one-shot search + create list; uses the match ranker)
- `inventory.ts`: `add_to_inventory`, `remove_from_inventory`, `get_shopping_profile`
- `orders.ts`: `record_order`
- `recipes.ts`: `get_meal_planning_context`
- `shopping-list.ts`: `create_shopping_list`
- `weekly-deals.ts`: `get_weekly_deals`; exports the weekly-deals KV cache key/entry helpers
- `item-flags.ts`: best-effort ` | in pantry` / ` | on sale: $X` line suffixes shared by `shop_for_items` and `create_shopping_list`; reads only the weekly-deals KV cache, never fetches the circular inline
- `resources.ts`: read-only MCP resources
- `schemas.ts`: shared Zod input helpers (UPC/storeId normalization, coerced quantities, case-insensitive modality)
- `types.ts`: shared tool context, auth helpers, response helpers, storage types
- `tool-types.ts`: Zod-inferred cross-module tool argument types

Services and utilities:

- `src/services/kroger/client.ts`: typed Kroger API clients, auth middleware, and the KV response-cache middleware.
- `src/services/kroger/product-service.ts`: `ProductService` wrapper over the product client (`getProduct`, `enrichProductName`); no caching of its own — the client layer already caches.
- `src/services/kroger/*.d.ts`: generated OpenAPI types (cart, location, product, identity) plus hand-maintained `weekly-deals.d.ts`.
- `src/services/qfc-weekly-deals.ts`: QFC weekly deals fetcher and Kroger Product API augmentation.
- `src/services/match-ranker.ts`: semantic re-ranking of `shop_for_items` candidates via Workers AI embeddings (`env.AI`, `@cf/baai/bge-small-en-v1.5`, 1.5s timeout, 30-day KV embedding cache). Hard invariant: never throws, never blocks long — any failure returns the original order.
- `src/utils/kv.ts`: `KvLike` (the `get`/`put` slice of `KVNamespace`), `isKvLike`, `getUserDataKv(env)`. Every KV-backed cache and storage path goes through these; do not re-derive KV access.
- `src/utils/result.ts`: `neverthrow` bridge helpers (`fromApiResponse`, `safeStorage`, `safeFetch`, `toMcpResponse`).
- `src/utils/json.ts`: `safeJsonParse`, `safeJsonParseWithSchema` (Zod-validated JSON parsing as `Result`).
- `src/utils/user-storage.ts`: Cloudflare KV-backed user data storage classes.
- `src/utils/deal-match.ts`: fuzzy token-overlap matching between item names and scraped deal titles.
- `src/utils/format-response.ts`: model-facing markdown formatting helpers.
- `src/utils/view-resource.ts`: MCP Apps view resource registration.

Views:

- `views/mcp-app.html` + `views/app.tsx`: Vite entry for the single MCP Apps React app.
- `views/app/views/`: individual tool result views.
- `views/shared/`: shared UI components, hooks, and the `_view` type union (`views/shared/types.ts`).
- `views/dev/`: local dev harness with mock data.
- `dist/views/`: generated output from `pnpm build:views`, served via the `ASSETS` binding.

Tests:

- `tests/`: vitest suites on `@cloudflare/vitest-pool-workers`, mirroring `src/` — `tests/tools/`, `tests/utils/`, `tests/services/`, `tests/views/`, `tests/integration/`, `tests/evals/`.
- `tests/tools/tool-test-harness.ts`: shared harness for tool unit tests.
- `tests/evals/harness.ts`: end-to-end eval harness (real Worker via `SELF`, real MCP client, fixture-backed Kroger API).

Design/plan documents live in `docs/` (`VISION.md`, `small-model-efficiency-plan.md`, `ROADMAP.md`, `cart-api-plan.md`). When a code comment cites one, read it before changing that code. `docs/VISION.md` is the north star: system architecture, host-integration contract, design principles (including explicitly rejected approaches), and the improvement backlog.

## Request And Server Lifecycle

`/mcp` is stateless. Every request builds a fresh `McpServer` through `buildServer(env, sessionId)` and serves it with `createMcpHandler`, so state cannot leak between clients. Keep it that way:

- The `Mcp-Session-Id` header carries the session id; a storage shim rebuilds minimal transport state from it. The session id only namespaces KV data — the user id comes from OAuth, not the header.
- Auth `Props` are read lazily inside tool execution via `getMcpAuthContext()`. Tool registration must not require auth context.
- There is no `requireAuth` wrapper; `OAuthProvider` enforces the auth invariant before requests reach `/mcp`. Do not reintroduce per-tool auth gating.
- No global mutable state anywhere in the Worker: clients, caches, and storage are constructed per request.

## OAuth And Tokens

The app has two OAuth layers:

1. MCP clients authenticate to this server through `@cloudflare/workers-oauth-provider`.
2. This server authenticates to Kroger on behalf of the user.

Kroger refresh tokens are single-use. Once used, they are invalidated and replaced. The only safe refresh path is:

- `tokenExchangeCallback` refreshes expiring Kroger tokens.
- The new Kroger access token and refresh token are persisted to the grant.
- The MCP token TTL is aligned with the Kroger token so refresh happens before expiry.

Do not add refresh behavior to `createKrogerAuthMiddleware`. That middleware attaches authorization headers and maps 401s to a re-auth error — nothing else.

Props are intentionally split:

- `Props`: `{ id, accessToken, tokenExpiresAt }`; safe runtime access-token props passed to tool execution.
- `GrantProps`: `Props & { refreshToken?, krogerClientId, krogerClientSecret }`; server-side grant data.

Keep Kroger credentials and refresh tokens out of runtime `Props`.

## Kroger API Details

Required Worker bindings/vars (see `wrangler.jsonc`): `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET`, `COOKIE_ENCRYPTION_KEY`, `USER_DATA_KV`, `OAUTH_KV`, `AI`, `ASSETS`.

Registered Kroger redirect URI:

```text
https://ai-meal-planner-mcp.aranlucas.workers.dev/callback
```

Required Kroger scopes: `profile.compact`, `cart.basic:write`, `product.compact`.

Token exchange and token refresh use direct `fetch()` calls with:

- `Content-Type: application/x-www-form-urlencoded`
- `Authorization: Basic ${btoa(`${clientId}:${clientSecret}`)}`
- `URLSearchParams` body parameters for the token endpoint

Kroger IDs have strict formats, but input schemas normalize reasonable variations instead of rejecting them (see `src/tools/schemas.ts`):

- UPCs are 13 digits; a 1-13 digit numeric string is trimmed and left-padded with zeros to 13.
- Store IDs (`storeId`) are exactly 8 characters after trimming whitespace.

## Caching Layers

All caches live in `USER_DATA_KV` and go through `KvLike` from `src/utils/kv.ts`. Every cache read/write is non-fatal: a read failure falls through to a live call, a write failure is logged and swallowed.

1. **Kroger response cache** — `createKrogerCacheMiddleware` in `src/services/kroger/client.ts`. Caches GET-only, 2xx-only responses for 600s, keyed by full URL (`kroger-cache|v1|{url}`). Applied to `productClient` and `locationClient` only, because their responses are not user-specific — sharing across users is the point. `cartClient` and `identityClient` are deliberately excluded; the cache has no per-user scoping, so adding them would leak user data. This middleware must return a plain `Response | undefined` for `openapi-fetch`.
2. **Weekly-deals cache** — populated by `get_weekly_deals`, read (never populated) by `item-flags.ts`. Cache key/entry helpers are exported from `src/tools/weekly-deals.ts`; reuse them instead of reconstructing keys.
3. **Embedding cache** — 30-day per-text embedding entries used by `src/services/match-ranker.ts`.

When adding a cache, decide explicitly whether the data is user-scoped; if it is, the key must include the user id.

## MCP Design Rules

Tools should follow MCP annotations consistently:

- `readOnlyHint`: true for search/query, false for mutations.
- `destructiveHint`: true for clear/delete capabilities.
- `idempotentHint`: true when repeating the same input has the same effect.
- `openWorldHint`: true for external APIs, false for local-only storage.

Current MCP tools:

- Shopping/products: `add_shopping_list_to_cart`, `search_stores`, `get_store`, `set_preferred_store`, `search_products`, `get_product`, `view_cart`
- One-shot shopping: `shop_for_items` (search + create a shopping list from item names, no cart add)
- Shopping list: `create_shopping_list`
- Inventory: `add_to_inventory`, `remove_from_inventory` (pantry or equipment), `get_shopping_profile` (read-only summary)
- Orders: `record_order`
- Recipes/meal planning: `get_meal_planning_context`
- Weekly deals: `get_weekly_deals`

Golden path for a small model: `shop_for_items` (or `search_products` → `create_shopping_list`) → `add_shopping_list_to_cart` with the returned `listId`. Call `get_shopping_profile` before personalized suggestions.

Current MCP resources: `shopping://user/pantry`, `shopping://user/kitchen-equipment`, `shopping://user/preferred-store`, `shopping://user/order-history`, `shopping://product/{upc}`.

MCP Sampling has been removed. `get_meal_planning_context` returns structured context for the host model to use; it should not call `createMessage`.

## The Small-Model Contract

`tests/evals/` pins the implicit contract this server offers to weak host models (see `tests/evals/README.md` for full details). If you change any tool response or schema, these rules must survive:

1. Every id a later tool needs is printed in `content[0].text` as `key=value` (`storeId=70500847`, `upc=0001111041700`, `listId=list_a1b2c3d8`) — extractable with a regex, no JSON parsing.
2. Response text names the next tool to call; error text names the concrete recovery tool, and following that advice must actually work.
3. Schemas normalize recoverable input (unpadded UPCs, string numbers, lowercase enums, whitespace) instead of rejecting it.
4. The golden path (`search_stores` → `set_preferred_store` → `shop_for_items` → `add_shopping_list_to_cart`) completes in 4 calls, and retrying the cart add is safe.

Eval knobs:

```bash
pnpm eval:mcp                 # deterministic suites (also part of pnpm test / CI)
EVAL_LOG=1 pnpm eval:mcp      # print measured token tables for recalibration
EVAL_LIVE=1 pnpm eval:mcp     # live small-model runs via remote Workers AI (real charges; needs CF credentials)
```

If an eval fails after a format change, the change broke small-model interop — fix the format or renegotiate the contract explicitly in the eval and `docs/small-model-efficiency-plan.md`.

## Data Persistence

User data is stored in Cloudflare KV through `src/utils/user-storage.ts`.

Storage classes: `PreferredLocationStorage`, `PantryStorage`, `EquipmentStorage`, `ShoppingListStorage`, `CartSnapshotStorage`, `OrderHistoryStorage`.

Storage expectations:

- Namespace keys by user ID: `user:{userId}:{dataType}`.
- Preserve case-insensitive deduplication for pantry, equipment, and shopping-list items.
- Preserve automatic quantity updates for duplicate items.
- Keep order history limited to the 50 most recent orders.
- Prefer existing storage and formatting helpers instead of introducing parallel persistence code.

## TypeScript Patterns

Import Zod as `import * as z from "zod/v4"` — the package is Zod 4; keep the `/v4` subpath consistent with existing files.

Use OpenAPI schema imports like this:

```typescript
import type { components as ProductComponents } from "./services/kroger/product.js";

type Product = ProductComponents["schemas"]["products.productModel"];
```

Do not derive types from client method signatures (`Awaited<ReturnType<typeof productClient.GET<...>>>`).

Prefer inference when TypeScript has enough information, especially for Zod tool-handler parameters, known array callbacks, and `openapi-fetch` response destructuring. Add explicit annotations when inference fails, when writing type guards, or when extracting complex reusable types.

Check generated schemas for exact property names before using API fields. Kroger properties may not match expected camelCase names; for example, use `fulfillment.instore`.

When consuming external JSON (KV entries, AI responses, scraped payloads), parse from `unknown` with a Zod schema via `safeJsonParseWithSchema` — never cast.

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

Prefer `ResultAsync.fromPromise`/`safeStorage`/`safeFetch`/`fromApiResponse` over raw `try/catch` for fallible async operations (KV reads/writes, external calls), even when the call site ultimately needs a plain value or throw — bridge back out at the boundary with `.match()`/`.orTee()`/`.unwrapOr()` (e.g. `createKrogerCacheMiddleware`, which must return a plain `Response | undefined` for `openapi-fetch`). Reach for a bare `try/catch` only when no existing helper fits and adding one isn't warranted.

Error messages are model-facing: state what failed and name the tool that fixes it. `tests/evals/error-actionability.eval.test.ts` enforces this.

## Product Search

`search_products` is intentionally bulk and parallel:

- Accept 1-10 search terms; return up to `limitPerTerm` products per term (1-10, default 5).
- Execute searches in parallel with `Promise.all()`.
- Send progress notifications after each search completes when the client provided a progress token.
- Do not convert this flow to sequential requests.
- Search logic is extracted as `searchProductsForTerms` in `src/tools/product.ts` and reused by `shop_for_items`.

`shop_for_items` additionally re-ranks each term's candidates through `src/services/match-ranker.ts` (Workers AI embeddings) before `pickBestMatch` applies its pickup-availability heuristic. Ranking is best-effort by hard invariant — never let it throw or block the search.

## Model-Facing Response Format

`content[0].text` (what the model reads) uses compact markdown, not TOON — small models can't reliably parse TOON. Markdown formatters live in `src/utils/format-response.ts` (`formatSearchProductsMarkdown`, `formatProductDetailMarkdown`, `formatStoreListMarkdown`, `formatStoreDetailMarkdown`, `formatWeeklyDealsMarkdown`). `structuredContent` is untouched by this — it still carries full data for the React views. `toonResource` in `src/tools/resources.ts` (MCP resources, not tools) is unaffected; `src/utils/toon.ts` is kept for that use.

Response size is budgeted: `tests/tools/response-size.test.ts` and `tests/evals/token-budget.eval.test.ts` fail when responses bloat. Trim content, don't raise budgets.

## MCP Apps Views

Tool responses can include rich UI by returning `structuredContent` and `_meta.ui.resourceUri`.

Startup registers the single shared view `ui://shopping-app` through `registerViewResource(ctx, APP_VIEW_URI, "mcp-app.html")`. The Vite React app receives tool results through `ontoolresult` and routes by `_view` (typed in `views/shared/types.ts`).

When adding or changing a view:

- Put view-specific code in `views/app/views/`; reuse shared UI from `views/shared/`.
- Update the dev harness mocks in `views/dev/` when the structured content shape changes.
- Run `pnpm build:views` or `pnpm build` (which also typechecks `views/tsconfig.json`).

## Testing Notes

- Tests run in the Workers pool (`@cloudflare/vitest-pool-workers`) against `wrangler.jsonc` with `remoteBindings: false`; the eval live-model suite is the one exception (remote-proxied `env.AI`).
- Test-only vars must be declared under miniflare `bindings` in `vitest.config.ts` — miniflare ignores `vars` there silently.
- Tool unit tests go through `tests/tools/tool-test-harness.ts`; end-to-end behavior goes through `tests/evals/harness.ts` fixtures. Extend the existing harness/fixtures rather than hand-rolling mocks.
- Integration OAuth flow coverage lives in `tests/integration/mcp-client-oauth-integration.test.ts`.

## MCP Client Connection

Example local proxy configuration:

```json
{
  "mcpServers": {
    "ai-shopping-list": {
      "command": "pnpm",
      "args": ["dlx", "mcp-remote", "https://ai-meal-planner-mcp.aranlucas.workers.dev/mcp"]
    }
  }
}
```

## Change Checklist

Before handing back code changes:

1. Add or update tests covering the change (new tools, resources, handlers, branches, and bug fixes all need tests).
2. Run the narrowest relevant test or build while iterating.
3. Run `pnpm build` (oxlint, view build, worker + views typecheck) when practical.
4. Always run `pnpm test` before handing back; never hand back with failing or missing tests.
5. If you changed a tool response format or schema, confirm `pnpm eval:mcp` passes — that is the small-model contract.
6. Mention any verification you could not run.

## Reference

- Kroger authorization docs: https://developer.kroger.com/reference/api/authorization-endpoints-public
- Reference implementation: https://github.com/CupOfOwls/kroger-mcp
- Design/plan docs: `docs/small-model-efficiency-plan.md`, `docs/ROADMAP.md`, `docs/cart-api-plan.md`, `tests/evals/README.md`

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Model Context Protocol (MCP) server that integrates with the Kroger API, deployed as a Cloudflare Worker. It allows AI models to manage QFC/Kroger shopping lists, search for products, find store locations, track pantry inventory, and provide intelligent shopping assistance using AI-powered features.

## Development Commands

### CRITICAL: Initial Setup and Verification

**Always run these commands when starting work:**

```bash
npm install                # Install dependencies (REQUIRED if node_modules doesn't exist)
npm run build              # Verify TypeScript compilation passes
```

**When using Task tool with subagents:** Subagents should always run `npm run build` after making code changes to verify compilation.

### Build & Type Checking

```bash
npm run build              # Lint (Biome) + build Views + type-check TypeScript (no output if successful)
npm run build:views        # Build Vite React views only (outputs to dist/views/)
npm run cf-typegen         # Generate Cloudflare Worker types
```

### Testing

```bash
npm test                          # Run Vitest test suite
npx vitest run path/to/test.ts    # Run a single test file
npx vitest run -t "test name"     # Run tests matching a name pattern
```

### Development & Deployment

```bash
npm run dev                # Start Wrangler dev server
npm start                  # Alias for dev
npm run deploy             # Deploy to Cloudflare Workers
```

### Code Quality

```bash
npm run lint               # Run Biome linter with auto-fix
```

### TypeScript Type Generation from OpenAPI

The project generates TypeScript types from OpenAPI YAML specs in the `kroger/` directory:

```bash
npm run generate:cart      # Generate cart.d.ts from cart.yaml
npm run generate:location  # Generate location.d.ts from location.yaml
npm run generate:product   # Generate product.d.ts from product.yaml
npm run generate:identity  # Generate identity.d.ts from identity.yaml
```

## Architecture

### MCP Server Structure

- **server.ts**: Main MCP server (`MyMCP` class extending `McpAgent`), OAuth provider config, and tool/resource/prompt registration entry point
- **tools/**: Modular tool registration files (each exports a `register*` function called from `server.ts`):
  - **tools/cart.ts**: Cart management tools (`add_to_cart`)
  - **tools/location.ts**: Location search and preference tools (`search_locations`, `get_location_details`, `set_preferred_location`)
  - **tools/product.ts**: Product search and details tools (`search_products`, `get_product_details`)
  - **tools/inventory.ts**: Consolidated pantry (`manage_pantry`), equipment (`manage_equipment`), and order history (`mark_order_placed`) tools
  - **tools/recipes.ts**: Recipe search and AI-powered meal planning tools (`search_recipes_from_web`, `plan_meals`)
  - **tools/shopping-list.ts**: Consolidated shopping list tool (`manage_shopping_list`) and checkout (`checkout_shopping_list`)
  - **tools/resources.ts**: MCP Resource definitions (read-only user data)
  - **tools/types.ts**: Shared types (`Props`, `GrantProps`, `ToolContext`, `UserStorage`) and helper functions (`requireAuth`, `resolveLocationId`, `errorResult`)
- **tools/tool-types.ts**: Zod-inferred type exports (`AddToCartArgs`, `ManageShoppingListArgs`) for cross-module use
- **errors.ts**: Domain error types (`AppError` discriminated union: `ApiError`, `AuthError`, `NotFoundError`, `ValidationError`, `StorageError`, `NetworkError`) and constructors
- **utils/result.ts**: neverthrow bridge utilities (`toMcpResponse`, `toMcpError`, `fromApiResponse`, `requireAuth`, `safeResolveLocationId`, `safeStorage`, `safeFetch`)
- **utils/view-resource.ts**: MCP Apps view resource registration — loads Vite-built HTML from Cloudflare ASSETS binding
- **prompts.ts**: MCP Prompt definitions for guided workflows
- **kroger-handler.ts**: Hono-based HTTP handlers for OAuth flow (`/authorize`, `/callback`)
- **workers-oauth-utils.ts**: OAuth utilities for approval dialogs and client verification
- **services/qfc-weekly-deals.ts**: QFC weekly deals fetcher (DACS print-ad API + Kroger Product API augmentation)

### OAuth Flow Architecture

The application uses a two-tier OAuth system:

1. **MCP Client OAuth**: Client (e.g., Claude Desktop) authenticates to this MCP server using `@cloudflare/workers-oauth-provider`
2. **Kroger OAuth**: This server authenticates to Kroger API on behalf of the user

**Token Synchronization**: When MCP tokens are refreshed, the `tokenExchangeCallback` in `server.ts` (OAuthProvider config) automatically refreshes Kroger tokens if they're expiring, keeping both OAuth flows in sync.

**CRITICAL - Single-Use Refresh Tokens**: Kroger uses single-use refresh tokens. Once a refresh token is used to obtain a new access token, it's immediately invalidated and replaced with a new refresh token. Token refresh is handled EXCLUSIVELY by `tokenExchangeCallback` to ensure the new refresh token is properly persisted to the grant. Middleware does NOT refresh tokens to avoid invalidating the refresh token before it can be persisted.

### Kroger API Client Architecture

All Kroger API clients are in `src/services/kroger/`:

- **client.ts**: `createKrogerClients(getTokenInfo)` factory creates all 4 typed `openapi-fetch` clients with auth middleware applied. Clients are passed to tool files via `ctx.clients` (no global singletons).
- **cart.d.ts, location.d.ts, product.d.ts, identity.d.ts**: Auto-generated TypeScript types from OpenAPI specs
- Middleware (`createKrogerAuthMiddleware`) adds Authorization headers but does NOT refresh tokens (see Token Refresh section below)

### Key OAuth Implementation Details

- **Authorization**: `/authorize` endpoint initiates OAuth, redirecting to Kroger
- **Callback**: `/callback` endpoint exchanges code for tokens, fetches user profile, stores tokens in `props`
- **Props/GrantProps Split** (defined in `tools/types.ts`):
  - `Props` = `{ id, accessToken, tokenExpiresAt }` — minimal data for runtime API calls, sent as `accessTokenProps`
  - `GrantProps` = `Props & { refreshToken?, krogerClientId, krogerClientSecret }` — full grant data, stays server-side in `newProps`
  - The `tokenExchangeCallback` destructures `GrantProps` into `{ refreshToken, krogerClientId, krogerClientSecret, ...accessTokenProps }` to split them
  - `Props` is structurally compatible with `KrogerTokenInfo`, so `createKrogerClients` receives `this.props` directly
- **Token Refresh**: Single-layer refresh strategy (IMPORTANT for Kroger's single-use refresh tokens):
  - Middleware (`createKrogerAuthMiddleware`): Only adds Authorization headers, does NOT refresh tokens
  - `tokenExchangeCallback`: Handles ALL token refresh operations
  - MCP token TTL matches Kroger's to ensure tokenExchangeCallback refreshes before expiry

## Kroger API Setup

### Required Environment Variables

- `KROGER_CLIENT_ID`: Kroger developer portal client ID
- `KROGER_CLIENT_SECRET`: Kroger developer portal client secret
- `COOKIE_ENCRYPTION_KEY`: Encryption key for OAuth cookies

### OAuth Redirect URI Configuration

The Kroger Developer Portal must have this exact redirect URI registered:

```
https://ai-meal-planner-mcp.aranlucas.workers.dev/callback
```

### OAuth Implementation (Following Kroger Authorization Tutorial)

The implementation follows Kroger's [Authorization Code Flow Tutorial](https://developer.kroger.com/reference/api/authorization-endpoints-public):

**Authorization Request** (`redirectToKroger` function in kroger-handler.ts):

- Uses `URL.searchParams.set()` for automatic URL encoding of parameters
- Required parameters: scope, response_type, client_id, redirect_uri, state
- State parameter contains base64-encoded OAuth request info

**Token Exchange** (`/callback` route in kroger-handler.ts):

- Uses `URLSearchParams` for automatic URL encoding of body parameters
- Authorization header: `Basic ${btoa(CLIENT_ID:CLIENT_SECRET)}` for base64 encoding
- Body parameters: grant_type, code, redirect_uri
- Content-Type: `application/x-www-form-urlencoded`

**Token Refresh** (`refreshKrogerToken` function in client.ts):

- **CRITICAL**: Kroger uses single-use refresh tokens - once used, they're invalidated
- Handled exclusively by `tokenExchangeCallback` in server.ts to persist new refresh tokens
- Same pattern as token exchange: URLSearchParams body, base64-encoded Authorization header
- Body parameters: grant_type=refresh_token, refresh_token
- Response includes NEW access_token AND NEW refresh_token (both must be saved)

**Encoding Notes:**

- **CRITICAL**: Kroger requires `%20` encoding for spaces in scope parameter, NOT `+` encoding
  - Use `encodeURIComponent()` directly, NOT `URLSearchParams.set()`
  - `encodeURIComponent()` produces `%20` for spaces ✅
  - `URLSearchParams` produces `+` for spaces ❌ (Kroger rejects this)
- `btoa()` performs base64 encoding (Cloudflare Worker equivalent of Node.js `Buffer.from().toString('base64')`)
- Example: `scope=profile.compact%20cart.basic%3Awrite%20product.compact` (spaces as `%20`, colons as `%3A`)

### Required OAuth Scopes

Set in `redirectToKroger` function (kroger-handler.ts):

- `profile.compact`: User profile access
- `cart.basic:write`: Shopping cart modification
- `product.compact`: Product search and details

## MCP Features

### MCP Tools

The server exposes 14 MCP tools, organized into modular files under `src/tools/`. Tools follow MCP best practices: consolidated CRUD operations use action discriminators, all tools include annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`), and errors use `isError: true` instead of throwing.

**Shopping & Products** (`tools/cart.ts`, `tools/location.ts`, `tools/product.ts`):

1. **add_to_cart**: Add items to cart with UPC, quantity, modality
2. **search_locations**: Find stores by zip code, chain name
3. **get_location_details**: Get store details by location ID
4. **search_products**: Bulk search for products using multiple terms (1-10 terms, 10 items per term limit, parallel execution)
5. **get_product_details**: Get product details by product ID
6. **set_preferred_location**: Save user's preferred store

**User Data Management** (`tools/inventory.ts`): 7. **manage_pantry**: Consolidated pantry tool with `action: "add" | "remove" | "clear"`. Add items with quantity/expiry, remove by name, or clear all. 8. **manage_equipment**: Consolidated equipment tool with `action: "add" | "remove" | "clear"`. Add equipment with optional category, remove by name, or clear all. 9. **mark_order_placed**: Record completed order in history

**Shopping List** (`tools/shopping-list.ts`): 10. **manage_shopping_list**: Consolidated shopping list tool with `action: "add" | "remove" | "update" | "clear"`. Add items (with optional UPC, quantity, notes), remove/update by name, or clear all. 11. **checkout_shopping_list**: Add unchecked items with UPCs to Kroger cart; reports items missing UPCs separately

**AI-Powered Tools** (`tools/recipes.ts`): 12. **search_recipes_from_web**: Search and extract recipes from Janella's Cookbook API 13. **plan_meals**: AI-powered meal suggestions based on pantry contents, equipment, dietary preferences, and expiring items (uses MCP Sampling with structured fallback)

**Weekly Deals** (`tools/weekly-deals.ts`): 14. **get_weekly_deals**: Fetches current QFC/Kroger weekly deals from the print ad (DACS API), augmented with real pricing from Kroger Product Search API. Results are KV-cached (6h fresh / 48h stale-while-revalidate).

**Note:** User data reads (pantry, equipment, location, order history, shopping list) are provided via **MCP Resources** (see below), not tools. This allows the AI to automatically access context without explicit tool calls.

### Tool Annotations

All tools include MCP annotations to help clients understand tool behavior:

- **readOnlyHint**: `true` for search/query tools, `false` for mutation tools
- **destructiveHint**: `true` for tools with clear/delete capability, `false` for additive-only
- **idempotentHint**: `true` for search tools and set_preferred_location (same input = same result)
- **openWorldHint**: `true` for tools that call external APIs (Kroger, recipe API), `false` for local-only tools

### MCP Resources

The server exposes contextual data via MCP Resources (defined in `src/tools/resources.ts`) that clients can automatically reference:

1. **shopping://user/pantry** - User's pantry inventory (items currently at home)
2. **shopping://user/equipment** - User's kitchen equipment inventory
3. **shopping://user/location** - User's preferred store location (with proactive guidance if not set)
4. **shopping://user/orders** - User's order history (last 20 orders)
5. **shopping://user/shopping-list** - Current shopping list with checked/unchecked status, UPC availability, and checkout readiness
6. **shopping://product/{productId}** - Product details by UPC (template resource; uses preferred location if available)

**How Resources Work:**

- Resources are automatically available to the AI without explicit tool calls
- Claude can proactively reference pantry contents, equipment, preferred location, purchase history, and shopping list
- Enables more natural conversations ("I see you already have milk in your pantry")
- Resources are read-only and provide context for better decision-making

**Architecture Decision:** Read operations for user data are provided exclusively via Resources (not tools) to eliminate redundancy. This means the AI always has access to user context without needing to explicitly call tools. Write/delete operations remain as tools.

### MCP Prompts

The server exposes guided workflow prompts (defined in `src/prompts.ts`):

1. **grocery_list_store_path** - Organize shopping route by aisle for efficiency
   - Optional parameter: `grocery_list` (items to organize)
   - Workflow: Search items, find aisle locations, suggest efficient store path

2. **set_preferred_store** - Choose and save a preferred store
   - Optional parameter: `zip_code` (5-digit zip code)
   - Workflow: Search nearby locations, present options, save preference

3. **add_recipe_to_cart** - Find a recipe and add ingredients to cart
   - Optional parameter: `recipe_type` (default: "classic apple pie")
   - Workflow: Search recipe, get ingredients, look up products, add to cart with substitution suggestions

### MCP Sampling

The server uses MCP Sampling to request AI completions from the client's model:

**Implementation:**

```typescript
const result = await this.server.server.createMessage({
  messages: [{ role: "user", content: { type: "text", text: prompt } }],
  maxTokens: 1000,
});
```

**Use Cases:**

- AI-powered meal planning from pantry contents (`plan_meals`)
- Recipe suggestions from pantry items
- Shopping list categorization by department
- Meal planning with dietary preferences and expiry-aware prioritization

**Web Scraping with Sampling:**
The `search_recipes_from_web` tool demonstrates AI-powered web scraping:

```typescript
// 1. Fetch webpage content
const response = await fetch(url);
const html = await response.text();

// 2. Clean HTML (remove scripts/styles, limit size)
const cleanedHtml = html.replace(/<script.*?<\/script>/gi, "").substring(0, 50000);

// 3. Ask LLM to parse and extract structured data
const result = await this.server.server.createMessage({
  messages: [
    {
      role: "user",
      content: {
        type: "text",
        text: `Parse this HTML and return JSON: ${cleanedHtml}`,
      },
    },
  ],
  maxTokens: 2000,
});

// 4. Parse LLM response as JSON
const data = JSON.parse(result.content.text);
```

**Security:** Sampling requests require user approval (handled by the MCP client)

### Bulk Product Search Implementation

The `search_products` tool implements parallel bulk search with progress tracking:

- Accepts array of 1-10 search terms
- Returns up to 10 items per search term (fixed limit)
- All searches execute in parallel using `Promise.all()` for optimal performance
- **Progress notifications** sent after each search completes (if client requests them)
- Results are aggregated and sorted (pickup in-stock → delivery → out-of-stock)
- Failed searches return empty results without breaking the entire operation

**Example Usage:**

```typescript
{
  "terms": ["milk", "bread", "eggs"],
  "locationId": "70500847"
}
```

**Performance Pattern with Progress Tracking:**

```typescript
// ✅ CORRECT - Parallel execution with progress notifications
const progressToken = extra?._meta?.progressToken;
let completedSearches = 0;

const searchPromises = terms.map(async (term) => {
  const { data, error } = await productClient.GET("/v1/products", { ... });

  // Send progress after each completion
  completedSearches++;
  if (progressToken && extra?.sendNotification) {
    await extra.sendNotification({
      method: "notifications/progress",
      params: {
        progressToken,
        progress: completedSearches,
        total: terms.length
      }
    });
  }

  return { term, products: data?.data || [] };
});
const results = await Promise.all(searchPromises);

// ❌ WRONG - Sequential execution (slow, defeats parallelism)
for (const term of terms) {
  const { data, error } = await productClient.GET("/v1/products", { ... });
}
```

## User Data Persistence

### Cloudflare KV Storage

The application uses Cloudflare KV (`USER_DATA_KV` binding) for persistent user data storage:

**Storage Module:** `src/utils/user-storage.ts`

**Data Types (each with a dedicated storage class):**

- **PreferredLocationStorage**: User's favorite store (location ID, name, address, chain)
- **PantryStorage**: Groceries at home (product name, quantity, added date, optional expiry date)
- **EquipmentStorage**: Kitchen equipment/tools (equipment name, category)
- **ShoppingListStorage**: Pre-checkout item list (product name, optional UPC, quantity, notes, checked status)
- **OrderHistoryStorage**: Past orders (order ID, items with prices, location, timestamp)

**Key Features:**

- Data namespaced by user ID for isolation (`user:{userId}:{dataType}`)
- JSON serialization for complex data structures
- Case-insensitive deduplication for pantry, equipment, and shopping list items
- Automatic quantity updates for duplicate items
- Order history limited to 50 most recent orders
- Formatted responses via `src/utils/format-response.ts`

**Environment Variables:**

- `USER_DATA_KV`: KV namespace binding (configured in wrangler.jsonc)

## Connecting MCP Clients

Use the `mcp-remote` local proxy to connect Claude Desktop:

```json
{
  "mcpServers": {
    "ai-shopping-list": {
      "command": "npx",
      "args": ["mcp-remote", "https://ai-meal-planner-mcp.aranlucas.workers.dev/sse"]
    }
  }
}
```

## Error Handling Pattern

### neverthrow Result Types

Newer tools use `neverthrow` (`Result`/`ResultAsync`) for type-safe error handling instead of try/catch. The bridge between Results and MCP responses lives in `src/utils/result.ts`:

```typescript
import { toMcpResponse, fromApiResponse, safeStorage } from "../utils/result.js";
import type { AppError } from "../errors.js";

// Wrap an openapi-fetch call
const result = await fromApiResponse(
  productClient.GET("/v1/products", { params: { query: { ... } } }),
  "search products"
);

// Convert Result to MCP tool response
return toMcpResponse(result.map(data => formatProducts(data)));
```

**AppError discriminated union** (defined in `src/errors.ts`): `ApiError | AuthError | NotFoundError | ValidationError | StorageError | NetworkError`. Use the constructors (`apiError()`, `authError()`, etc.) — never construct the objects directly.

Older tools use the simpler `errorResult(message)` / `textResult(text)` helpers from `tools/types.ts`. Both patterns coexist; prefer the neverthrow pattern for new tools.

## MCP Apps / React Views

Tools can return rich UI by registering a view resource and including `structuredContent` in their response. The view is a Vite-built React app (`views/app/`) served from the Cloudflare ASSETS binding.

**How it works:**

1. At startup: `registerViewResource(ctx, APP_VIEW_URI, "app.html")` registers a single `ui://shopping-app` resource
2. Tool response includes `structuredContent: { ...data }` and `_meta: { ui: { resourceUri: APP_VIEW_URI } }`
3. MCP host fetches the resource HTML, renders it in an iframe, passes tool result via `ontoolresult`
4. React app routes to the correct view component based on `_view` discriminator

**View components** live in `views/app/views/`. Each view handles one tool's `structuredContent` shape. Shared UI components are in `views/shared/`.

**Build:** `npm run build:views` compiles the React app into a single inlined HTML file via `vite-plugin-singlefile`.

## TypeScript Best Practices

### CRITICAL: Never Use `any` Types

- **NEVER** use `any` type in TypeScript code
- Always use proper types from OpenAPI-generated schemas
- Use explicit type annotations for all function parameters and return values
- When working with OpenAPI types, use the `components["schemas"]["..."]` pattern

**Example - Correct Type Usage:**

```typescript
import type { components as ProductComponents } from "../services/kroger/product.js";
type Product = ProductComponents["schemas"]["products.productModel"];

function formatProduct(product: Product): string {
  // Always type parameters in callbacks
  product.aisleLocations?.map((loc: AisleLocation) => loc.description);
}
```

**Example - WRONG (Never Do This):**

```typescript
function formatProduct(product: any): string {
  // ❌ NEVER USE ANY
  product.aisleLocations?.map((loc) => loc.description); // ❌ Missing type
}
```

### Type Annotation Requirements

Prefer TypeScript type inference over explicit annotations when TypeScript can reliably infer the type. Zod schema tool handler parameters, array callbacks with known element types, and `openapi-fetch` response destructuring are all inferred automatically — don't re-annotate them.

Only add explicit annotations when:

- TypeScript cannot infer the type (compile error)
- Type narrowing is needed (type guards, e.g. `(item): item is ValidItem => ...`)
- Defining reusable type aliases for complex OpenAPI schema types

### Proper Property Access

- Always check the OpenAPI schema for correct property names
- Properties in the API may differ from expected naming conventions
- Example: `fulfillment.instore` (lowercase) not `fulfillment.inStore` (camelCase)

### Importing OpenAPI Types in server.ts

**CRITICAL: Always import component types directly from the OpenAPI schema files, NOT from client method return types.**

**✅ CORRECT - Import types from schema files:**

```typescript
import type { components } from "./services/kroger/cart.js";
import type { components as ProductComponents } from "./services/kroger/product.js";
import type { components as LocationComponents } from "./services/kroger/location.js";

// Use the imported types
type ProductItem = ProductComponents["schemas"]["products.productModel"];
type Location = LocationComponents["schemas"]["locations.location"];
type CartItem = components["schemas"]["cart.cartItemModel"];
```

**❌ WRONG - Do NOT infer types from client methods:**

```typescript
// ❌ This causes TypeScript compilation errors
type Product = NonNullable<
  Awaited<ReturnType<typeof productClient.GET<"/v1/products">>>["data"]
>["data"];
type ProductItem = NonNullable<Product>[number];
```

**Why This Matters:**

- The `openapi-fetch` client methods have complex generic signatures that don't work with `ReturnType`
- TypeScript cannot properly infer the return types from client methods
- Direct schema imports are cleaner, more reliable, and compile correctly
- This is the pattern used throughout the codebase (see individual tool files in `src/tools/`)

**Available Schema Types:**

- **Product API**: `ProductComponents["schemas"]["products.productModel"]`
- **Location API**: `LocationComponents["schemas"]["locations.location"]`
- **Cart API**: `components["schemas"]["cart.cartItemModel"]`
- **Identity API**: Import as needed from `./services/kroger/identity.js`

## Important Implementation Notes

### UPC and Location ID Formats

- **UPC codes**: Must be exactly 13 digits (enforced via Zod validation in tool schemas)
- **Location IDs**: Must be exactly 8 characters (enforced throughout)

### Token Management

- Access tokens expire after 30 minutes (1800s default)
- Refresh buffer is 5 minutes (`isKrogerTokenExpiring` in client.ts), clock skew buffer is 1 minute (middleware)
- Token refresh handled exclusively by `tokenExchangeCallback` in server.ts (NOT in middleware)
- Kroger credentials (`krogerClientId`, `krogerClientSecret`) stored in `GrantProps` (server-side grant), not in `Props` (access token)

### API Client Pattern

All Kroger API interactions use `openapi-fetch` with typed clients, except:

1. OAuth token exchange (uses direct `fetch()` per Kroger docs)
2. Token refresh (uses direct `fetch()` for Kroger's token endpoint)

## Reference Implementations

### Kroger MCP Implementations

- **CupOfOwls/kroger-mcp** - https://github.com/CupOfOwls/kroger-mcp
  - Python-based FastMCP implementation
  - Includes MCP prompts for guided workflows
  - Local cart tracking workaround for API limitations
  - Reference for feature ideas and UX patterns

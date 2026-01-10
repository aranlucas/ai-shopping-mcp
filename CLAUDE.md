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
npm run build              # Type-check with TypeScript (no output)
npm run cf-typegen         # Generate Cloudflare Worker types
```

### Testing
```bash
npm test                   # Run Jest test suite
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
- **server.ts**: Main MCP server (`MyMCP` class extending `McpAgent`) that defines all MCP tools
- **kroger-handler.ts**: Hono-based HTTP handlers for OAuth flow (`/authorize`, `/callback`)
- **workers-oauth-utils.ts**: OAuth utilities for approval dialogs and client verification

### OAuth Flow Architecture
The application uses a two-tier OAuth system:

1. **MCP Client OAuth**: Client (e.g., Claude Desktop) authenticates to this MCP server using `@cloudflare/workers-oauth-provider`
2. **Kroger OAuth**: This server authenticates to Kroger API on behalf of the user

**Token Synchronization**: When MCP tokens are refreshed, the `tokenExchangeCallback` in `server.ts` (OAuthProvider config) automatically refreshes Kroger tokens if they're expiring, keeping both OAuth flows in sync.

**CRITICAL - Single-Use Refresh Tokens**: Kroger uses single-use refresh tokens. Once a refresh token is used to obtain a new access token, it's immediately invalidated and replaced with a new refresh token. Token refresh is handled EXCLUSIVELY by `tokenExchangeCallback` to ensure the new refresh token is properly persisted to the grant. Middleware does NOT refresh tokens to avoid invalidating the refresh token before it can be persisted.

### Kroger API Client Architecture
All Kroger API clients are in `src/services/kroger/`:
- **client.ts**: Creates typed `openapi-fetch` clients with authentication middleware that adds Bearer tokens to requests
- **cart.d.ts, location.d.ts, product.d.ts, identity.d.ts**: Auto-generated TypeScript types from OpenAPI specs
- Middleware (`createKrogerAuthMiddleware`) adds Authorization headers but does NOT refresh tokens (see Token Refresh section below)

### Key OAuth Implementation Details
- **Authorization**: `/authorize` endpoint initiates OAuth, redirecting to Kroger
- **Callback**: `/callback` endpoint exchanges code for tokens, fetches user profile, stores tokens in `props`
- **Props Structure**: User ID, Kroger access/refresh tokens, expiry timestamp, and Kroger credentials are encrypted in the MCP token
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

The server exposes these MCP tools (all defined in server.ts):

**Shopping & Products:**
1. **add_to_cart**: Add items to cart with UPC, quantity, modality
2. **search_locations**: Find stores by zip code, chain name
3. **get_location_details**: Get store details by location ID
4. **search_products**: Bulk search for products using multiple terms (1-10 terms, 10 items per term limit, parallel execution)
5. **get_product_details**: Get product details by product ID

**User Data Persistence (Cloudflare KV):**
6. **set_preferred_location**: Save user's preferred store
7. **get_preferred_location**: Retrieve saved preferred store
8. **add_to_pantry**: Add items to pantry inventory
9. **remove_from_pantry**: Remove items from pantry
10. **view_pantry**: Display all pantry items
11. **clear_pantry**: Clear pantry inventory
12. **mark_order_placed**: Record completed order in history
13. **view_order_history**: Display past orders

**AI-Powered Tools (Using MCP Sampling):**
14. **suggest_recipes_from_pantry**: Uses AI to suggest recipes based on pantry inventory
15. **categorize_shopping_list**: Uses AI to organize shopping lists by store department
16. **get_weekly_deals_from_web**: Uses AI to scrape and extract deals from QFC weekly ad webpage

### MCP Resources

The server exposes contextual data via MCP Resources that clients can automatically reference:

1. **shopping://user/pantry** - User's pantry inventory (items currently at home)
2. **shopping://user/location** - User's preferred store location
3. **shopping://user/orders** - User's order history (last 20 orders)
4. **shopping://product/{productId}** - Product details by UPC (template resource)

**How Resources Work:**
- Resources are automatically available to the AI without explicit tool calls
- Claude can proactively reference pantry contents, preferred location, and purchase history
- Enables more natural conversations ("I see you already have milk in your pantry")
- Resources are read-only and provide context for better decision-making

### MCP Sampling

The server uses MCP Sampling to request AI completions from the client's model:

**Implementation:**
```typescript
const result = await this.server.server.createMessage({
  messages: [{ role: "user", content: { type: "text", text: prompt } }],
  maxTokens: 1000
});
```

**Use Cases:**
- Recipe suggestions from pantry items
- Shopping list categorization by department
- Web scraping and data extraction (weekly deals from public webpages)
- Meal planning assistance

**Web Scraping with Sampling:**
The `get_weekly_deals_from_web` tool demonstrates AI-powered web scraping:
```typescript
// 1. Fetch webpage content
const response = await fetch(url);
const html = await response.text();

// 2. Clean HTML (remove scripts/styles, limit size)
const cleanedHtml = html
  .replace(/<script.*?<\/script>/gi, '')
  .substring(0, 50000);

// 3. Ask LLM to parse and extract structured data
const result = await this.server.server.createMessage({
  messages: [{
    role: "user",
    content: {
      type: "text",
      text: `Parse this HTML and return JSON: ${cleanedHtml}`
    }
  }],
  maxTokens: 2000
});

// 4. Parse LLM response as JSON
const data = JSON.parse(result.content.text);
```

**Security:** Sampling requests require user approval (handled by the MCP client)

### Bulk Product Search Implementation
The `search_products` tool implements parallel bulk search:
- Accepts array of 1-10 search terms
- Returns up to 10 items per search term (fixed limit)
- All searches execute in parallel using `Promise.all()` for optimal performance
- Results are aggregated and sorted (pickup in-stock → delivery → out-of-stock)
- Failed searches return empty results without breaking the entire operation

**Example Usage:**
```typescript
{
  "terms": ["milk", "bread", "eggs"],
  "locationId": "70500847"
}
```

**Performance Pattern:**
```typescript
// ✅ CORRECT - Parallel execution with type inference
const searchPromises = terms.map(async (term) => {  // TypeScript infers term is string
  const { data, error } = await productClient.GET("/v1/products", { ... });
  return { term, products: data?.data || [], count: products.length };
});
const results = await Promise.all(searchPromises);

// ❌ WRONG - Sequential execution (slow)
for (const term of terms) {
  const { data, error } = await productClient.GET("/v1/products", { ... });
}
```


## User Data Persistence

### Cloudflare KV Storage
The application uses Cloudflare KV (`USER_DATA_KV` binding) for persistent user data storage:

**Storage Module:** `src/utils/user-storage.ts`

**Data Types:**
- **Preferred Location**: Saves user's favorite store (location ID, name, address, chain)
- **Pantry Items**: Tracks groceries at home (product ID, name, quantity, added date, expiry date)
- **Order History**: Records past orders (order ID, items, prices, totals, location, timestamp)

**Key Features:**
- Data namespaced by user ID for isolation (`user:{userId}:{dataType}`)
- JSON serialization for complex data structures
- Automatic quantity updates for duplicate pantry items
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
      "args": [
        "mcp-remote",
        "https://ai-meal-planner-mcp.aranlucas.workers.dev/sse"
      ]
    }
  }
}
```

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
function formatProduct(product: any): string {  // ❌ NEVER USE ANY
  product.aisleLocations?.map((loc) => loc.description);  // ❌ Missing type
}
```

### Type Annotation Requirements

**IMPORTANT: Prefer TypeScript type inference over explicit annotations when TypeScript can reliably infer the type.**

1. **Zod Schema Integration**: Tool handler parameters are automatically typed by Zod schemas
   ```typescript
   // ✅ CORRECT - TypeScript infers types from Zod schema
   this.server.registerTool("search_products", {
     inputSchema: z.object({
       terms: z.array(z.string()),
       locationId: z.string()
     })
   }, async ({ terms, locationId }) => {  // Types inferred automatically
     // terms is string[], locationId is string
   });

   // ❌ WRONG - Redundant explicit typing
   async ({ terms, locationId }: { terms: string[], locationId: string }) => { ... }
   ```

2. **Array Callbacks**: Use inference when the array type is known
   ```typescript
   // ✅ CORRECT - TypeScript infers term is string from terms: string[]
   terms.map(async (term) => {
     const result = await productClient.GET("/v1/products", { ... });
     return { term, products: result.data };
   });

   // ❌ UNNECESSARY - Type annotation redundant when TypeScript can infer
   terms.map(async (term: string) => { ... })

   // ✅ NECESSARY - Explicit type needed when inference isn't clear
   items.filter((item): item is ValidItem => item.valid !== false)
   ```

3. **OpenAPI Schema Types**: Use the generated type definitions for complex types
   ```typescript
   // ✅ CORRECT - Use generated types for complex structures
   type ProductItem = ProductComponents["schemas"]["products.productModel"];
   const allProducts: ProductItem[] = [];

   // ❌ WRONG - Don't use any or create manual interfaces
   type Product = any;
   ```

**Rule of Thumb:** Only add explicit type annotations when:
- TypeScript cannot infer the type (compile error)
- Type narrowing is needed (type guards)
- Improving code clarity for complex types
- Defining reusable type aliases

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
- This is the pattern used throughout the codebase (see cart items, line 100)

**Available Schema Types:**
- **Product API**: `ProductComponents["schemas"]["products.productModel"]`
- **Location API**: `LocationComponents["schemas"]["locations.location"]`
- **Cart API**: `components["schemas"]["cart.cartItemModel"]`
- **Identity API**: Import as needed from `./services/kroger/identity.js`

## Important Implementation Notes

### UPC and Location ID Formats
- **UPC codes**: Must be exactly 13 digits (enforced in server.ts:79)
- **Location IDs**: Must be exactly 8 characters (enforced throughout)

### Token Management
- Access tokens expire after 30 minutes (1800s default)
- Refresh buffer is 5 minutes (client.ts:89)
- Token refresh is automatic and happens in two places for reliability
- Kroger credentials must be stored in props for token refresh to work

### API Client Pattern
All Kroger API interactions use `openapi-fetch` with typed clients, except:
1. OAuth token exchange (uses direct `fetch()` per Kroger docs)
2. Weekly deals (uses `fetch()` for custom headers and undocumented endpoints)

## Reference Implementations

### Kroger MCP Implementations
- **CupOfOwls/kroger-mcp** - https://github.com/CupOfOwls/kroger-mcp
  - Python-based FastMCP implementation
  - Includes MCP prompts for guided workflows
  - Local cart tracking workaround for API limitations
  - Reference for feature ideas and UX patterns

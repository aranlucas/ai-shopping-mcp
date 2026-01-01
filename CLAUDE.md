# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Model Context Protocol (MCP) server that integrates with the Kroger API, deployed as a Cloudflare Worker. It allows AI models to manage QFC/Kroger shopping lists, search for products, find store locations, and access weekly deals.

## Development Commands

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

**Token Synchronization**: When MCP tokens are refreshed, the `tokenExchangeCallback` in server.ts:600 automatically refreshes Kroger tokens if they're expiring, keeping both OAuth flows in sync.

### Kroger API Client Architecture
All Kroger API clients are in `src/services/kroger/`:
- **client.ts**: Creates typed `openapi-fetch` clients with automatic token refresh middleware
- **cart.d.ts, location.d.ts, product.d.ts, identity.d.ts**: Auto-generated TypeScript types from OpenAPI specs
- Token refresh happens automatically via middleware before each API call (client.ts:99)

### Key OAuth Implementation Details
- **Authorization**: `/authorize` endpoint (kroger-handler.ts:21) initiates OAuth, redirecting to Kroger
- **Callback**: `/callback` endpoint (kroger-handler.ts:155) exchanges code for tokens, fetches user profile, stores tokens in `props`
- **Props Structure**: User ID, Kroger access/refresh tokens, expiry timestamp, and Kroger credentials are encrypted in the MCP token
- **Token Refresh**: Dual-layer refresh strategy:
  - Middleware refresh (client.ts:104): Refreshes during API calls
  - Callback refresh (server.ts:614): Refreshes during MCP token exchange

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

**Authorization Request (kroger-handler.ts:109-123):**
- Uses `URL.searchParams.set()` for automatic URL encoding of parameters
- Required parameters: scope, response_type, client_id, redirect_uri, state
- State parameter contains base64-encoded OAuth request info

**Token Exchange (kroger-handler.ts:209-230):**
- Uses `URLSearchParams` for automatic URL encoding of body parameters
- Authorization header: `Basic ${btoa(CLIENT_ID:CLIENT_SECRET)}` for base64 encoding
- Body parameters: grant_type, code, redirect_uri
- Content-Type: `application/x-www-form-urlencoded`

**Token Refresh (client.ts:32-46):**
- Same pattern as token exchange
- Body parameters: grant_type, refresh_token
- Uses same base64 encoding for Authorization header

**Encoding Notes:**
- **CRITICAL**: Kroger requires `%20` encoding for spaces in scope parameter, NOT `+` encoding
  - Use `encodeURIComponent()` directly, NOT `URLSearchParams.set()`
  - `encodeURIComponent()` produces `%20` for spaces ✅
  - `URLSearchParams` produces `+` for spaces ❌ (Kroger rejects this)
- `btoa()` performs base64 encoding (Cloudflare Worker equivalent of Node.js `Buffer.from().toString('base64')`)
- Example: `scope=profile.compact%20cart.basic%3Awrite%20product.compact` (spaces as `%20`, colons as `%3A`)

### Required OAuth Scopes
Set in kroger-handler.ts:133:
- `profile.compact`: User profile access
- `cart.basic:write`: Shopping cart modification
- `product.compact`: Product search and details

## MCP Tools

The server exposes these MCP tools (all defined in server.ts):

1. **add_to_cart** (line 73): Add items to cart with UPC, quantity, modality
2. **search_locations** (line 138): Find stores by zip code, chain name
3. **get_location_details** (line 202): Get store details by location ID
4. **search_products** (line 250): Search products by term, location, product ID
5. **get_product_details** (line 368): Get product details by product ID
6. **get_weekly_deals** (line 429): Fetch current weekly deals using Kroger's circulars API

### Weekly Deals Implementation
Unlike other tools, weekly deals uses direct `fetch()` calls (not `openapi-fetch`) because it requires:
- Custom `x-laf-object` header with location/facility data structure
- Calls to both the circulars API and QFC's shoppable-weekly-deals endpoint
- Non-standard API that's not in the official OpenAPI specs

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
1. **Function Parameters**: Always explicitly type all parameters
   ```typescript
   // ✅ Correct
   ({ grocery_list }: { grocery_list: string }) => { ... }

   // ❌ Wrong
   ({ grocery_list }) => { ... }
   ```

2. **Array Callbacks**: Type all callback parameters
   ```typescript
   // ✅ Correct
   items.map((item: Item) => item.name)

   // ❌ Wrong
   items.map((item) => item.name)
   ```

3. **OpenAPI Schema Types**: Use the generated type definitions
   ```typescript
   // ✅ Correct - Use generated types
   type Product = ProductComponents["schemas"]["products.productModel"];
   type Location = LocationComponents["schemas"]["locations.location"];

   // ❌ Wrong - Don't use any or create manual interfaces
   type Product = any;
   ```

### Proper Property Access
- Always check the OpenAPI schema for correct property names
- Properties in the API may differ from expected naming conventions
- Example: `fulfillment.instore` (lowercase) not `fulfillment.inStore` (camelCase)

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

# MCP API Redesign Design

## Goal

Redesign the MCP API surface so the model-facing contract is clear, workflow-oriented, and internally consistent. Backward compatibility is not required, so tool, resource, prompt, and view discriminator names should be changed when that improves agent behavior.

## Current Problems

The current API mostly works, but the contract is uneven:

- Some tools advertise the shared MCP App UI while returning only text or no known `_view`, which can leave app hosts with a routeable UI shell but no view data.
- Broad `manage_*` tools combine additive, destructive, and clearing operations under one annotation set, so `destructiveHint` and `idempotentHint` cannot be accurate.
- `search_products` allows 25 terms even though repo guidance says 1-10 terms.
- `create_shopping_list` accepts an empty item list, and an existing test name says that should be rejected.
- `add_recipe_to_cart` still implies web recipe search even though that tool was removed.
- Recent changes removed output schemas from app-backed tools, while the installed MCP SDK and ext-apps package support output schemas and validate `structuredContent`.
- Server instructions compress too much workflow guidance into one sentence and do not distinguish context reads from cart mutations.

## Design Choice

Use a workflow-first API redesign. Keep the behavior users need, but rename and split tools so the tool list itself teaches the host model the right workflow.

This is better than a minimal metadata cleanup because no compatibility constraint exists. The model should not have to infer whether `manage_pantry` with `action: "clear"` is destructive while `action: "add"` is not. Separate tools let annotations, descriptions, and schemas match behavior exactly.

## Tool Surface

### Store Tools

- `search_stores`
  - Replaces `search_locations`.
  - Read-only, external API.
  - Finds Kroger/QFC stores near a 5-digit zip code.
  - Returns app view `_view: "search_stores"`.
- `get_store`
  - Replaces `get_location_details`.
  - Read-only, external API.
  - Fetches one store by 8-character location ID.
  - Returns app view `_view: "get_store"`.
- `set_preferred_store`
  - Replaces `set_preferred_location`.
  - Mutates local user storage after validating the location through Kroger.
  - Returns structured app view `_view: "set_preferred_store"` or does not advertise app UI. The preferred design is to add the structured app view because the existing location result UI already supports store selection flows.

### Product Tools

- `search_products`
  - Keeps the name because it is already precise.
  - Accepts 1-10 terms, not 25.
  - Executes searches in parallel and keeps progress notifications.
  - Returns `_view: "search_products"` for successful, empty, and partial-failure searches. Empty search is not an error.
- `get_product`
  - Replaces `get_product_details`.
  - Read-only, external API.
  - Fetches one product by 13-digit UPC.
  - Returns `_view: "get_product"`.

### Shopping List And Cart Tools

- `create_shopping_list`
  - Keeps the name because it describes an immutable snapshot well.
  - Requires at least one item.
  - Returns `_view: "create_shopping_list"` and a `shopping_list_id`.
- `add_shopping_list_to_cart`
  - Replaces `add_to_cart`.
  - Requires a `shopping_list_id`.
  - Uses preferred store when no location ID is supplied.
  - Uses elicitation before adding UPC-backed items when the client supports it.
  - Returns `_view: "add_shopping_list_to_cart"` whether all items were added or some still need UPCs.

### Pantry Tools

Split `manage_pantry` into:

- `add_pantry_items`
  - Non-destructive, local storage mutation.
  - Adds or quantity-merges pantry items.
  - Returns `_view: "pantry"`.
- `remove_pantry_items`
  - Destructive, local storage mutation.
  - Removes named pantry items.
  - Returns `_view: "pantry"`.
- `clear_pantry`
  - Destructive and idempotent.
  - Clears pantry inventory.
  - Returns `_view: "pantry"`.

### Kitchen Equipment Tools

Split `manage_equipment` into:

- `add_kitchen_equipment`
  - Non-destructive, local storage mutation.
  - Returns `_view: "kitchen_equipment"`.
- `remove_kitchen_equipment`
  - Destructive, local storage mutation.
  - Returns `_view: "kitchen_equipment"`.
- `clear_kitchen_equipment`
  - Destructive and idempotent.
  - Returns `_view: "kitchen_equipment"`.

This also fixes the current inconsistency where equipment tools advertise UI metadata but return only text.

### Order Tool

- `record_order`
  - Replaces `mark_order_placed`.
  - Records an order only after the user has actually placed it outside this MCP server.
  - Returns `_view: "record_order"`.

### Meal Planning Tool

- `get_meal_planning_context`
  - Replaces `plan_meals`.
  - Read-only, local storage only.
  - Returns structured context for the host model to plan meals; it does not claim to be AI-powered and does not call sampling.
  - Does not advertise app UI unless a real meal-planning context view is added. The preferred design is text plus structuredContent without app UI for now.

### Weekly Deals Tool

- `get_weekly_deals`
  - Keeps the name because it is precise.
  - Read-only, external API and KV cache.
  - Returns `_view: "get_weekly_deals"`.

## Resource Surface

Rename resource titles and URIs to match the redesigned language:

- `shopping://user/pantry`
  - Title: `Pantry`
- `shopping://user/kitchen-equipment`
  - Replaces `shopping://user/equipment`
  - Title: `Kitchen Equipment`
- `shopping://user/preferred-store`
  - Replaces `shopping://user/location`
  - Title: `Preferred Store`
- `shopping://user/order-history`
  - Replaces `shopping://user/orders`
  - Title: `Order History`
- `shopping://product/{upc}`
  - Keeps the URI pattern but describes the parameter as a 13-digit UPC, not a generic product ID.

Do not add a shopping-list resource. Shopping lists are immutable, session-scoped snapshots created by `create_shopping_list`.

## Prompt Surface

Rename and update prompts to reflect current capabilities:

- `plan_shopping_route`
  - Replaces `grocery-list-store_path`.
  - Organizes a shopping trip by store aisle or department. It must not add items to cart.
- `set_preferred_store`
  - Keeps the workflow name and points to `search_stores` plus `set_preferred_store`.
- `shop_recipe_ingredients`
  - Replaces `add_recipe_to_cart`.
  - Does not claim the server searches recipe websites. It asks the host model to work from the user's recipe or its own model knowledge, search products for ingredients, create a shopping list, and optionally add it to cart after user confirmation.
- `plan_meals_from_pantry`
  - New prompt that tells the host model to call `get_meal_planning_context`, then produce meals and optionally create a shopping list for missing ingredients.

## Server Instructions

Rewrite server instructions as a compact workflow guide:

- Read resources first for personalization when meal planning, pantry-aware shopping, or repeat purchase suggestions matter.
- If no preferred store exists and availability or cart operations matter, ask for zip code, call `search_stores`, then call `set_preferred_store`.
- For cart workflows, call `search_products` to obtain UPCs, then `create_shopping_list`, then `add_shopping_list_to_cart`.
- Never imply the server completes payment or places orders. The human completes checkout in Kroger/QFC; `record_order` is only for recording a completed order.
- `get_meal_planning_context` returns context for the host model; the server does not generate meals through sampling.

## Structured Output Contract

Every app-backed tool must declare a tool-local `outputSchema`. The schema must describe the `structuredContent` object and include a literal `_view` discriminator.

Nested Kroger API payloads must remain loose with `z.looseObject` so new Kroger fields do not break validation.

The app view union in `views/shared/types.ts` must match the server output schema discriminators exactly. If output schemas are restored as runtime Zod exports, the views may infer types from those schemas again. If bundling or dependency concerns make type-only imports fragile, keep explicit view types but add tests that compare `_view` values and output schemas.

Text-only tools must not include `_meta.ui.resourceUri`. If a tool declares UI metadata, every non-error success path must return routeable structured content.

## View Changes

Update the shared React app router to use the renamed `_view` values:

- `search_stores`
- `get_store`
- `set_preferred_store`
- `search_products`
- `get_product`
- `create_shopping_list`
- `add_shopping_list_to_cart`
- `pantry`
- `kitchen_equipment`
- `get_weekly_deals`
- `record_order`

Reuse existing view components where possible and rename component props/types only as needed. Add a small kitchen equipment view if equipment tools return structured content and no existing view fits.

Update `views/dev/mockData.ts` and the dev harness for every renamed discriminator.

## Annotation Rules

Use annotations consistently:

- Search/get tools: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true` for Kroger/API-backed reads.
- Local resource-like reads such as `get_meal_planning_context`: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: false` if time-sensitive context or generated timestamps can differ, `openWorldHint: false`.
- Add/update local storage: `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`, `openWorldHint: false`.
- Remove/clear local storage: `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: true` for clear operations and false for remove operations if repeated removes produce materially different user feedback, `openWorldHint: false`.
- Cart mutation: `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`, `openWorldHint: true`.

## Testing Strategy

Add or restore a contract test suite under `tests/evals/` or `tests/tools/` that registers the full API and asserts:

- Exact tool names equal the redesigned surface.
- No legacy tool names remain.
- Every tool has a title, description, input schema, and annotations.
- UI metadata is present only for app-backed tools.
- Every UI-backed tool has an output schema.
- Every output schema accepts a representative `_view` payload.
- `search_products` accepts 1-10 terms and rejects 11.
- `create_shopping_list` rejects empty `items`.
- Prompt names equal the redesigned prompt surface and no stale `search_recipes_from_web`, `manage_shopping_list`, or `checkout_shopping_list` wording remains.
- Resource names and URIs equal the redesigned resource surface.

Update existing unit tests as part of each tool rename. Use TDD for behavior changes: write the failing contract or unit test first, verify it fails, then change production code.

Before handing back implementation, run:

- Targeted tests while iterating.
- `pnpm build` because the change touches views and TypeScript contracts.
- `pnpm test` because this is a behavioral API change.

## Rollout Notes

There is no backward compatibility requirement. Do not keep aliases for old tool, resource, prompt, or `_view` names. Removing old names is intentional because it keeps the model-facing API compact and prevents hosts from choosing stale workflows.

## Self-Review

- No placeholders remain.
- The design explicitly chooses a non-compatible workflow-first API.
- Tool, resource, prompt, output schema, annotation, view, and testing changes are covered.
- The design preserves key architecture constraints: stateless `/mcp`, lazy auth props, no per-tool auth wrapper, Kroger refresh only in OAuth token exchange, loose nested Kroger schemas, and no MCP sampling in meal planning.

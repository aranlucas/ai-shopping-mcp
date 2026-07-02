# Kroger MCP Server - Backlog

## Not Yet Implemented

### Location Management

- `check_location_exists` - Validate location IDs

### Cart Management

The Kroger API cannot return cart contents, so `view_current_cart` /
`remove_from_cart` / `clear_current_cart` need a local mirror of what this
assistant has added. This is planned as Phase 2 item 4 ("Local cart mirror +
`view_cart`") in `docs/small-model-efficiency-plan.md` — generalizing
`CartSnapshotStorage` from per-list snapshots to a per-user rolling mirror,
not a new ad hoc tracking mechanism.

### Product Search

- `search_products_by_id` - Dedicated ID-based search
- `get_product_images` - Retrieve product images with perspective options

### General Enhancements

- Rate limit tracking and warnings
- Pagination support for large result sets
- Chain and department validation

## Rejected

These mirror the reference implementation's 26-tool surface but don't serve
any golden path here; each added tool costs every request ~200-350 tokens
(see `docs/small-model-efficiency-plan.md`, "Non-goals: Growing the tool
surface"). Not planned:

- `test_authentication` - OAuth is enforced by `OAuthProvider` before requests
  reach `/mcp`; there is no per-tool auth state for a model to introspect
  (AGENTS.md, "Request And Server Lifecycle").
- `get_authentication_info` - Same reasoning; auth details aren't
  model-actionable and add surface without a workflow that needs them.
- `get_user_profile` - No golden path reads the raw Kroger profile; preferred
  store and shopping history are already exposed via `get_shopping_profile`.
- `list_chains` - Store discovery goes through `search_stores` with a `chain`
  parameter; a separate enumeration tool duplicates that without saving calls.
- `list_departments` - Department names are already included in `get_store`
  output; a dedicated tool is redundant.
- `force_reauthenticate` - Re-authentication is an MCP-client-level OAuth
  flow, not something a tool call inside a session can or should trigger.

## References

- [CupOfOwls/kroger-mcp](https://github.com/CupOfOwls/kroger-mcp) - Reference implementation
- [Kroger Developer Portal](https://developer.kroger.com/) - API documentation

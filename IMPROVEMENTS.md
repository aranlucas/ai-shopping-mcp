# Kroger MCP Server - Backlog

## Not Yet Implemented

### Location Management

- `check_location_exists` - Validate location IDs

### Cart Management

The Kroger API cannot return cart contents. To support viewing/removing cart items, a local mirror is needed:

- `view_current_cart` - Display cart contents (requires local tracking via KV/Durable Objects)
- `remove_from_cart` - Remove specific items (requires local tracking)
- `clear_current_cart` - Empty cart (requires local tracking)

### Profile & Information

- `get_user_profile` - Retrieve Kroger user profile
- `list_chains` - Show available Kroger family chains
- `list_departments` - Show store departments
- `test_authentication` - Verify OAuth status
- `get_authentication_info` - Show auth details
- `force_reauthenticate` - Re-trigger OAuth flow

### Product Search

- `search_products_by_id` - Dedicated ID-based search
- `get_product_images` - Retrieve product images with perspective options

### General Enhancements

- Rate limit tracking and warnings
- Pagination support for large result sets
- Chain and department validation

## References

- [CupOfOwls/kroger-mcp](https://github.com/CupOfOwls/kroger-mcp) - Reference implementation
- [Kroger Developer Portal](https://developer.kroger.com/) - API documentation

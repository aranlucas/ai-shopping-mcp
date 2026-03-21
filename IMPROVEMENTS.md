# Kroger MCP Server - Improvements from CupOfOwls/kroger-mcp

## Overview

This document summarizes the improvements made to the Kroger MCP server based on analysis of the [CupOfOwls/kroger-mcp](https://github.com/CupOfOwls/kroger-mcp) repository.

## Implemented Improvements

### ✅ 1. MCP Prompts (NEW FEATURE)

Added 3 specialized prompts for guided workflows:

**Location:** `src/prompts.ts`

- **grocery_list_store_path** - Helps users find the optimal path through a store based on their grocery list
  - Takes a grocery list and organizes items by aisle/department
  - Suggests efficient shopping routes
  - Does NOT add items to cart automatically

- **set_preferred_store** - Guides users through selecting their preferred store
  - Searches nearby locations by zip code
  - Displays options with addresses and distances
  - Helps set preferred location for future searches

- **add_recipe_to_cart** - Finds recipes and auto-adds ingredients
  - Searches for specified recipe type
  - Shows ingredients and instructions
  - Looks up items at local store
  - Adds available ingredients to cart
  - Suggests alternatives for unavailable items

### ✅ 2. Formatted Responses (ENHANCEMENT)

Improved user experience with human-readable responses instead of raw JSON:

**Location:** `src/utils/format-response.ts`

**Product Formatting:**

- Markdown formatted product names
- Clear pricing with sale indicators
- Size and availability information
- Category and aisle locations
- UPC codes for reference

**Location Formatting:**

- Store name, chain, and address
- Phone numbers and location IDs
- Operating hours with timezone
- Department listings

**Weekly Deals Formatting:**

- Deal descriptions with pricing
- Savings amounts/percentages
- Valid date ranges
- Loyalty requirements
- Department categories

**Updated Tools:**

- `search_products` - Now returns formatted product list
- `get_product_details` - Formatted single product display
- `search_locations` - Formatted location list
- `get_location_details` - Formatted single location
- `get_weekly_deals` - Formatted deals with circular info

## Suggested Future Improvements

### ✅ 3. User Data Persistence with Cloudflare KV (IMPLEMENTED)

Implemented persistent storage for user data using Cloudflare KV:

**Location:** `src/utils/user-storage.ts`, `src/server.ts` (lines 596-911)

**Preferred Location Management:**

- `set_preferred_location` - Save user's preferred store location
- `get_preferred_location` - Retrieve saved preferred store
- Stores: location ID, name, address, chain, timestamp

**Pantry Management:**

- `add_to_pantry` - Add items to personal pantry inventory
- `remove_from_pantry` - Remove items from pantry
- `view_pantry` - Display all pantry items
- `clear_pantry` - Clear all pantry items
- Tracks: product ID, name, quantity, added date, optional expiry date
- Automatically updates quantities for duplicate items

**Order History:**

- `mark_order_placed` - Record completed orders
- `view_order_history` - Display past orders (up to 50 most recent)
- Tracks: order ID, items, quantities, prices, totals, location, notes, timestamp
- Auto-generates unique order IDs

**Storage Architecture:**

- Uses Cloudflare KV for persistence (`USER_DATA_KV` binding)
- Data namespaced by user ID for isolation
- JSON serialization for complex data structures
- Formatted responses for user-friendly display

**Benefits:**

- Users can save preferred shopping location
- Track what groceries are already at home
- Maintain shopping history across sessions
- Better meal planning and inventory management

### 🔮 Additional Tools (Not Yet Implemented)

**Location Management:**

- `check_location_exists` - Validate location IDs

**Cart Management:**

- `view_current_cart` - Display cart contents (requires local tracking)
- `remove_from_cart` - Remove specific items (requires local tracking)
- `clear_current_cart` - Empty cart (requires local tracking)

**Profile & Information:**

- `get_user_profile` - Retrieve Kroger user profile
- `list_chains` - Show available Kroger family chains
- `list_departments` - Show store departments
- `test_authentication` - Verify OAuth status
- `get_authentication_info` - Show auth details
- `force_reauthenticate` - Re-trigger OAuth flow

**Utilities:**

- `get_current_datetime` - Provide time context for availability checks

**Product Search:**

- `search_products_by_id` - Dedicated ID-based search
- `get_product_images` - Retrieve product images

### 🔮 Local State Management

The Kroger API limitation: **cannot view cart contents via API**

**Solution from reference implementation:**

- Use Durable Objects storage to maintain local cart state
- Track cart items in `kroger_cart.json`
- Track order history in `kroger_order_history.json`
- Sync additions via API, but maintain local mirror for viewing

**Benefits:**

- Users can see what's in their cart
- Support for remove/clear operations (local only)
- Order history tracking
- Better UX despite API limitations

### 🔮 Additional Enhancements

- Rate limit tracking and warnings
- Better error messages with actionable guidance
- Pagination support for large result sets
- Image retrieval with perspective options
- Chain and department validation
- Enhanced authentication status tools

## Technical Notes

### Architecture Changes

1. **New Files:**
   - `src/prompts.ts` - MCP prompt definitions
   - `src/utils/format-response.ts` - Response formatting utilities

2. **Modified Files:**
   - `src/server.ts` - Registers prompts and uses formatting utilities

### Response Format Changes

**Before:**

```json
{
  "message": "Found 5 products",
  "count": 5,
  "products": [...],
  "success": true
}
```

**After:**

```markdown
Found 5 product(s):

1. **Organic Milk**
   Brand: Horizon
   Price: $5.99
   Size: 1 gallon
   Available for: Pickup, Delivery
   UPC: 1234567890123
   Category: Dairy > Milk
   Aisle: Dairy (12)
```

### Limitations & Trade-offs

- Formatted responses are more readable but harder to parse programmatically
- Cart viewing/management requires storage implementation (Durable Objects)
- Order history requires persistent storage beyond current session

## References

- [CupOfOwls/kroger-mcp](https://github.com/CupOfOwls/kroger-mcp) - Reference implementation
- [Kroger Developer Portal](https://developer.kroger.com/) - API documentation

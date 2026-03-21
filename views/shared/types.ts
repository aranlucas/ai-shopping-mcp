import type { App } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type {
  AddToCartArgs,
  ManageShoppingListArgs,
} from "../../src/tools/tool-types.js";

import type {
  AddToCartArgs,
  ManageShoppingListArgs,
} from "../../src/tools/tool-types.js";

/** Discriminated union of all callable tools — enables type-safe callTool(). */
export type ToolCall =
  | { name: "add_to_cart"; arguments: AddToCartArgs }
  | { name: "manage_shopping_list"; arguments: ManageShoppingListArgs }
  | { name: "manage_pantry"; arguments: Record<string, unknown> }
  | { name: "set_preferred_location"; arguments: { locationId: string } }
  | { name: "get_location_details"; arguments: { locationId: string } }
  | { name: "search_products"; arguments: { terms: string[] } };

/** Timeout for app-initiated callServerTool() calls (ms).
 *  Without this, calls hang indefinitely when the host doesn't respond. */
export const TOOL_CALL_TIMEOUT_MS = 15_000;

/**
 * Type-safe wrapper around app.callServerTool() with a timeout.
 * Returns the Promise so callers can await results and handle errors.
 */
export function callTool(
  app: App | null | undefined,
  call: ToolCall,
): Promise<CallToolResult> | undefined {
  return app?.callServerTool(call as Parameters<App["callServerTool"]>[0], {
    timeout: TOOL_CALL_TIMEOUT_MS,
  });
}

export interface DealData {
  title: string;
  details?: string;
  price?: string;
  savings?: string | null;
  validFrom?: string;
  validTill?: string;
}

export interface WeeklyDealsContent {
  deals: DealData[];
  validFrom?: string;
  validTill?: string;
}

export interface LocationData {
  locationId: string;
  name?: string;
  chain?: string;
  address?: {
    addressLine1?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
  phone?: string;
  departments?: Array<{ name?: string; phone?: string }>;
}

export interface LocationResultsContent {
  locations: LocationData[];
}

export interface LocationDetailContent {
  location: LocationData;
}

export interface ProductData {
  upc?: string;
  description?: string;
  brand?: string;
  categories?: string[];
  aisleLocations?: Array<{
    description?: string;
    number?: string;
  }>;
  items?: Array<{
    itemId?: string;
    size?: string;
    price?: { regular?: number; promo?: number };
    fulfillment?: {
      curbside?: boolean;
      delivery?: boolean;
      instore?: boolean;
    };
    inventory?: { stockLevel?: string };
  }>;
}

export interface ProductSearchResultsContent {
  results: Array<{
    term: string;
    products: ProductData[];
    failed: boolean;
  }>;
  totalProducts: number;
}

export interface ProductDetailContent {
  product: ProductData;
}

export interface PantryItemData {
  productName: string;
  quantity: number;
  addedAt?: string;
  expiresAt?: string;
}

export interface PantryListContent {
  items: PantryItemData[];
  actionDetail?: string;
}

export interface ShoppingListItemData {
  productName: string;
  upc?: string;
  quantity: number;
  notes?: string;
  addedAt?: string;
  checked: boolean;
}

export interface ShoppingListContent {
  items: ShoppingListItemData[];
  actionDetail?: string;
}

export interface RecipeData {
  title: string;
  description?: string;
  cuisine?: string;
  difficulty?: string;
  totalTime?: number;
  cookTime?: number;
  servings?: string;
  slug: string;
  ingredients?: Array<{
    quantity?: string;
    unit?: string;
    name: string;
    notes?: string;
  }>;
  instructions?: Array<{
    stepNumber: number;
    instruction: string;
  }>;
}

export interface RecipeResultsContent {
  recipes: RecipeData[];
  searchQuery: string;
}

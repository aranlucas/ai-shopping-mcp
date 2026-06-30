import type { App } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type {
  AddToCartArgs,
  CreateShoppingListArgs,
  ManagePantryArgs,
} from "../../src/tools/tool-types.js";

export type { AddToCartArgs, CreateShoppingListArgs, ManagePantryArgs };

/** Discriminated union of all callable tools — enables type-safe callTool(). */
export type ToolCall =
  | { name: "add_to_cart"; arguments: AddToCartArgs }
  | { name: "create_shopping_list"; arguments: CreateShoppingListArgs }
  | { name: "manage_pantry"; arguments: ManagePantryArgs }
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

/** Open an external URL via the host. No-ops if the host doesn't support openLink. */
export async function openExternalLink(app: App | null | undefined, url: string): Promise<void> {
  if (!app?.getHostCapabilities()?.openLinks) return;
  await app.openLink({ url });
}

/** Send a short message to the host on behalf of the user. Best-effort. */
export function sendUserMessage(app: App | null | undefined, text: string): void {
  app?.sendMessage({
    role: "user",
    content: [{ type: "text", text }],
  });
}

export type DealData = {
  title: string;
  details?: string;
  price?: string;
  savings?: string | null;
  validFrom?: string;
  validTill?: string;
};

export type WeeklyDealsContent = {
  _view: "get_weekly_deals";
  deals: DealData[];
  validFrom?: string;
  validTill?: string;
  cache?: { state: "miss" | "fresh" | "stale" };
};

export type LocationData = {
  locationId?: string;
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
};

export type LocationResultsContent = {
  _view: "search_locations";
  locations: LocationData[];
};

export type LocationDetailContent = {
  _view: "get_location_details";
  location: LocationData;
};

export type ProductData = {
  upc?: string;
  description?: string;
  brand?: string;
  categories?: string[];
  aisleLocations?: Array<{ description?: string; number?: string }>;
  images?: Array<{
    perspective?: string;
    default?: boolean;
    sizes?: Array<{ id?: string; size?: string; url?: string }>;
  }>;
  items?: Array<{
    itemId?: string;
    size?: string;
    price?: { regular?: number; promo?: number };
    fulfillment?: {
      curbside?: boolean;
      delivery?: boolean;
      instore?: boolean;
      shiptohome?: boolean;
    };
    inventory?: { stockLevel?: string };
  }>;
};

export type ProductSearchResultsContent = {
  _view: "search_products";
  results: Array<{
    term: string;
    products: ProductData[];
    count?: number;
    failed: boolean;
  }>;
  totalProducts: number;
};

export type ProductDetailContent = {
  _view: "get_product_details";
  product: ProductData;
};

export type PantryItemData = {
  productName: string;
  quantity: number;
  addedAt?: string;
  expiresAt?: string;
};

export type PantryListContent = {
  _view: "manage_pantry";
  items: PantryItemData[];
  actionDetail?: string;
};

export type ShoppingListItemData = {
  productName: string;
  upc?: string;
  quantity: number;
  notes?: string;
};

export type ShoppingListContent = {
  _view: "create_shopping_list";
  shopping_list_id: string;
  name: string;
  items: ShoppingListItemData[];
  actionDetail?: string;
};

export type AddToCartContent = {
  _view: "add_to_cart";
  shopping_list_id: string;
  name: string;
  items: Array<{
    upc: string;
    quantity: number;
    modality: "PICKUP" | "DELIVERY";
    productName?: string;
  }>;
  needsUpc: Array<{ productName: string; quantity: number }>;
  actionDetail?: string;
};

export type OrderItemData = {
  productId: string;
  productName: string;
  quantity: number;
  price?: number;
};

export type OrderHistoryContent = {
  _view: "mark_order_placed";
  orderId: string;
  items: OrderItemData[];
  totalItems: number;
  estimatedTotal?: number;
  placedAt: string;
  locationId?: string;
  notes?: string;
};

/**
 * Discriminated union of all possible tool `structuredContent` shapes.
 * Each member carries its `_view` literal, so this narrows cleanly on
 * `data._view`.
 */
export type AppData =
  | ProductSearchResultsContent
  | ProductDetailContent
  | LocationResultsContent
  | LocationDetailContent
  | ShoppingListContent
  | PantryListContent
  | WeeklyDealsContent
  | OrderHistoryContent
  | AddToCartContent;

/**
 * Exhaustive map of the `_view` discriminators we know how to render. Typing it
 * as `Record<AppData["_view"], true>` makes it a compile error to add a view
 * to `AppData` without registering it here, so the runtime `KNOWN_VIEWS` set
 * below can't silently drift from the type.
 */
const VIEW_NAMES: Record<AppData["_view"], true> = {
  search_products: true,
  get_product_details: true,
  search_locations: true,
  get_location_details: true,
  create_shopping_list: true,
  manage_pantry: true,
  get_weekly_deals: true,
  mark_order_placed: true,
  add_to_cart: true,
};

/** The set of `_view` discriminators we know how to render. */
const KNOWN_VIEWS = new Set(Object.keys(VIEW_NAMES) as AppData["_view"][]);

/**
 * Parse unknown structuredContent into a typed AppData value.
 * Returns null if the value is missing or carries an unrecognized `_view`,
 * so an unknown payload surfaces as "loading" rather than a blank render.
 */
export function parseStructuredContent(raw: unknown): AppData | null {
  if (!raw || typeof raw !== "object") return null;
  const view = (raw as { _view?: unknown })._view;
  if (typeof view !== "string" || !KNOWN_VIEWS.has(view as AppData["_view"])) return null;
  return raw as AppData;
}

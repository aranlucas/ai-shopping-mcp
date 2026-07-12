import type { App } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type {
  AddShoppingListToCartArgs,
  AddToInventoryArgs,
  CreateShoppingListArgs,
  RemoveFromInventoryArgs,
} from "../../src/tools/tool-types.js";
import { APP_VIEW_META_KEY } from "../../src/utils/view-meta.js";

export type {
  AddShoppingListToCartArgs,
  AddToInventoryArgs,
  CreateShoppingListArgs,
  RemoveFromInventoryArgs,
};

/** Discriminated union of callable tools used by the app UI. */
export type ToolCall =
  | { name: "add_shopping_list_to_cart"; arguments: AddShoppingListToCartArgs }
  | { name: "create_shopping_list"; arguments: CreateShoppingListArgs }
  | { name: "add_to_inventory"; arguments: AddToInventoryArgs }
  | { name: "remove_from_inventory"; arguments: RemoveFromInventoryArgs }
  | { name: "set_preferred_store"; arguments: { storeId: string } }
  | { name: "get_store"; arguments: { storeId: string } }
  | { name: "search_products"; arguments: { terms: string[]; storeId?: string } };

/** Timeout for app-initiated callServerTool() calls (ms). */
export const TOOL_CALL_TIMEOUT_MS = 15_000;

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
  category: string;
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

export type StoreResultsContent = {
  _view: "search_stores";
  stores: LocationData[];
};

export type StoreDetailContent = {
  _view: "get_store";
  store: LocationData;
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
  _view: "get_product";
  product: ProductData;
};

export type PantryItemData = {
  productName: string;
  quantity: number;
  addedAt?: string;
  expiresAt?: string;
};

export type PantryListContent = {
  _view: "pantry";
  items: PantryItemData[];
  actionDetail?: string;
};

export type KitchenEquipmentItemData = {
  equipmentName: string;
  category?: string;
  addedAt?: string;
};

export type KitchenEquipmentContent = {
  _view: "kitchen_equipment";
  items: KitchenEquipmentItemData[];
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
  listId: string;
  name: string;
  items: ShoppingListItemData[];
  actionDetail?: string;
};

export type AddShoppingListToCartContent = {
  _view: "add_shopping_list_to_cart";
  /** Absent when items were added inline (no listId). */
  listId?: string;
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
  upc: string;
  productName: string;
  quantity: number;
  price?: number;
};

export type OrderHistoryContent = {
  _view: "record_order";
  orderId: string;
  items: OrderItemData[];
  totalItems: number;
  estimatedTotal?: number;
  placedAt: string;
  locationId?: string;
  notes?: string;
};

export type AppData =
  | ProductSearchResultsContent
  | ProductDetailContent
  | StoreResultsContent
  | StoreDetailContent
  | ShoppingListContent
  | PantryListContent
  | KitchenEquipmentContent
  | WeeklyDealsContent
  | OrderHistoryContent
  | AddShoppingListToCartContent;

const VIEW_NAMES: Record<AppData["_view"], true> = {
  search_products: true,
  get_product: true,
  search_stores: true,
  get_store: true,
  create_shopping_list: true,
  pantry: true,
  kitchen_equipment: true,
  get_weekly_deals: true,
  record_order: true,
  add_shopping_list_to_cart: true,
};

const KNOWN_VIEWS = new Set(Object.keys(VIEW_NAMES) as AppData["_view"][]);

/** Convert a wire result into the app's internal discriminated view data. */
export function parseToolResult(result: CallToolResult | null | undefined): AppData | null {
  const content = result?.structuredContent;
  const view = result?._meta?.[APP_VIEW_META_KEY];
  if (!content || typeof view !== "string" || !KNOWN_VIEWS.has(view as AppData["_view"])) {
    return null;
  }
  return { ...content, _view: view } as AppData;
}

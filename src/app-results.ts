import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Namespaced CallToolResult metadata key used to route the shared MCP App. */
export const APP_VIEW_META_KEY = "dev.aranlucas/view";

export type DealData = {
  title: string;
  details?: string;
  price?: string;
  savings?: string | null;
  validFrom?: string;
  validTill?: string;
  category: string;
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

export type PreferredStoreData = {
  locationId: string;
  locationName: string;
  address: string;
  chain: string;
  setAt: string;
};

export type ProductData = {
  upc?: string;
  description?: string;
  brand?: string;
  categories?: string[];
  aisleLocations?: Array<{
    bayNumber?: string;
    description?: string;
    number?: string;
    numberOfFacings?: string;
    sequenceNumber?: string;
    side?: string;
    shelfNumber?: string;
    shelfPositionInBay?: string;
  }>;
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

export type PantryItemData = {
  productName: string;
  quantity: number;
  addedAt?: string;
  expiresAt?: string;
};

export type KitchenEquipmentItemData = {
  equipmentName: string;
  category?: string;
  addedAt?: string;
};

export type ShoppingListItemData = {
  productName: string;
  upc?: string;
  quantity: number;
  notes?: string;
};

export type OrderItemData = {
  upc: string;
  productName: string;
  quantity: number;
  price?: number;
};

export type AppResultPayloads = {
  get_weekly_deals: {
    deals: DealData[];
    validFrom?: string;
    validTill?: string;
    cache?: { state: "miss" | "fresh" | "stale" };
  };
  search_stores: { stores: LocationData[] };
  get_store: { store: LocationData };
  set_preferred_store: {
    store: PreferredStoreData;
    actionDetail: string;
  };
  search_products: {
    results: Array<{
      term: string;
      products: ProductData[];
      count?: number;
      failed: boolean;
    }>;
    totalProducts: number;
  };
  get_product: { product: ProductData };
  pantry: { items: PantryItemData[]; actionDetail?: string };
  kitchen_equipment: { items: KitchenEquipmentItemData[]; actionDetail?: string };
  create_shopping_list: {
    listId: string;
    name: string;
    items: ShoppingListItemData[];
    actionDetail?: string;
  };
  add_shopping_list_to_cart: {
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
  record_order: {
    orderId: string;
    items: OrderItemData[];
    totalItems: number;
    estimatedTotal?: number;
    placedAt: string;
    locationId?: string;
    notes?: string;
  };
};

export type AppViewName = keyof AppResultPayloads;

export type AppData = {
  [View in AppViewName]: { view: View } & AppResultPayloads[View];
}[AppViewName];

export type WeeklyDealsContent = Extract<AppData, { view: "get_weekly_deals" }>;
export type StoreResultsContent = Extract<AppData, { view: "search_stores" }>;
export type StoreDetailContent = Extract<AppData, { view: "get_store" }>;
export type PreferredStoreContent = Extract<AppData, { view: "set_preferred_store" }>;
export type ProductSearchResultsContent = Extract<AppData, { view: "search_products" }>;
export type ProductDetailContent = Extract<AppData, { view: "get_product" }>;
export type PantryListContent = Extract<AppData, { view: "pantry" }>;
export type KitchenEquipmentContent = Extract<AppData, { view: "kitchen_equipment" }>;
export type ShoppingListContent = Extract<AppData, { view: "create_shopping_list" }>;
export type AddShoppingListToCartContent = Extract<AppData, { view: "add_shopping_list_to_cart" }>;
export type OrderHistoryContent = Extract<AppData, { view: "record_order" }>;

export const APP_VIEW_NAMES: Record<AppViewName, true> = {
  get_weekly_deals: true,
  search_stores: true,
  get_store: true,
  set_preferred_store: true,
  search_products: true,
  get_product: true,
  pantry: true,
  kitchen_equipment: true,
  create_shopping_list: true,
  add_shopping_list_to_cart: true,
  record_order: true,
};

const APP_VIEW_NAME_SET = new Set(Object.keys(APP_VIEW_NAMES));

/** Attach a typed MCP Apps payload and its routing metadata to a tool result. */
export function appResult<View extends AppViewName>(
  view: View,
  structuredContent: AppResultPayloads[View],
) {
  return {
    _meta: { [APP_VIEW_META_KEY]: view },
    structuredContent,
  };
}

/** Convert a wire result into the app's internal discriminated view data. */
export function parseAppResult(result: CallToolResult | null | undefined): AppData | null {
  const structuredContent = result?.structuredContent;
  const view = result?._meta?.[APP_VIEW_META_KEY];
  if (
    !structuredContent ||
    typeof view !== "string" ||
    !APP_VIEW_NAME_SET.has(view as AppViewName)
  ) {
    return null;
  }

  return { ...structuredContent, view } as AppData;
}

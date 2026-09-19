import type { ProductReference } from "../services/catalog/types.js";

export interface PantryItem {
  productName: string;
  quantity: number;
  addedAt: string;
  expiresAt?: string;
}

export interface OrderRecord {
  orderId: string;
  items: Array<{
    product?: ProductReference;
    productName: string;
    quantity: number;
    price?: number;
  }>;
  totalItems: number;
  estimatedTotal?: number;
  placedAt: string;
  locationId?: string;
  notes?: string;
}

export interface PreferredLocation {
  provider: string;
  locationId: string;
  locationName: string;
  address: string;
  chain: string;
  setAt: string;
}

export interface EquipmentItem {
  equipmentName: string;
  category?: string;
  addedAt: string;
}

export interface ShoppingListItem {
  productName: string;
  product?: ProductReference;
  quantity: number;
  notes?: string;
}

/** A record returned by storage always has durable identity and checked state. */
export interface StoredShoppingListItem extends ShoppingListItem {
  id: string;
  checked: boolean;
}

/** A list without its items, for pickers that only need to name the list. */
export interface ShoppingListSummary {
  id: string;
  name: string;
  itemCount: number;
  updatedAt: string;
}

/** Fields an edit may change. Omitted fields are left as they are. */
export interface ShoppingListItemPatch {
  productName?: string;
  quantity?: number;
  notes?: string;
  checked?: boolean;
}

export interface ShoppingList {
  id: string;
  name: string;
  items: StoredShoppingListItem[];
  createdAt: string;
}

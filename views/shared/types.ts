/**
 * Shared structuredContent types used by both server tool handlers
 * and client-side Views. Keep these in sync.
 */

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

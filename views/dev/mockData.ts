import type {
  AddToCartContent,
  LocationDetailContent,
  LocationResultsContent,
  PantryListContent,
  ProductDetailContent,
  ProductSearchResultsContent,
  ShoppingListContent,
  WeeklyDealsContent,
} from "../shared/types.js";

export const mockAddToCart: AddToCartContent = {
  _view: "add_to_cart",
  shopping_list_id: "user-123:session:dev-session:list:abc12345",
  name: "Tuesday Dinner",
  items: [
    {
      upc: "0001111042578",
      quantity: 2,
      modality: "PICKUP",
      productName: "Organic Whole Milk",
    },
    {
      upc: "0002100062282",
      quantity: 1,
      modality: "PICKUP",
      productName: "Chicken Breast",
    },
  ],
  needsUpc: [{ productName: "Strawberries", quantity: 2 }],
  actionDetail: 'Added 2 item(s) from list "Tuesday Dinner" to cart',
};

export const mockWeeklyDeals: WeeklyDealsContent = {
  _view: "get_weekly_deals",
  validFrom: "2026-03-18",
  validTill: "2026-03-24",
  deals: [
    {
      title: "Organic Whole Milk",
      details: "1 gallon, QFC Brand",
      price: "$3.99",
      savings: "Save $1.50",
      validFrom: "2026-03-18",
      validTill: "2026-03-24",
    },
    {
      title: "Boneless Chicken Breast",
      details: "Per lb, family pack",
      price: "$2.99/lb",
      savings: "Save $2.00/lb",
    },
    {
      title: "Strawberries",
      details: "1 lb clamshell",
      price: "$2.49",
      savings: "Save $1.00",
    },
    {
      title: "Sourdough Bread",
      details: "24 oz loaf",
      price: "$4.49",
      savings: null,
    },
  ],
};

export const mockProductSearch: ProductSearchResultsContent = {
  _view: "search_products",
  totalProducts: 3,
  results: [
    {
      term: "milk",
      failed: false,
      products: [
        {
          upc: "0001111042578",
          description: "Organic Whole Milk",
          brand: "QFC",
          categories: ["Dairy", "Milk"],
          aisleLocations: [{ description: "Dairy", number: "12" }],
          items: [
            {
              itemId: "item1",
              size: "1 gal",
              price: { regular: 5.49, promo: 3.99 },
              fulfillment: { curbside: true, delivery: true, instore: true },
              inventory: { stockLevel: "HIGH" },
            },
          ],
        },
        {
          upc: "0001111042579",
          description: "2% Reduced Fat Milk",
          brand: "Lucerne",
          categories: ["Dairy", "Milk"],
          aisleLocations: [{ description: "Dairy", number: "12" }],
          items: [
            {
              itemId: "item2",
              size: "1 gal",
              price: { regular: 4.29 },
              fulfillment: { curbside: true, delivery: false, instore: true },
              inventory: { stockLevel: "LOW" },
            },
          ],
        },
      ],
    },
  ],
};

export const mockProductDetail: ProductDetailContent = {
  _view: "get_product_details",
  product: {
    upc: "0001111042578",
    description: "Organic Whole Milk",
    brand: "QFC",
    categories: ["Dairy", "Milk"],
    aisleLocations: [{ description: "Dairy", number: "12" }],
    items: [
      {
        itemId: "item1",
        size: "1 gal",
        price: { regular: 5.49, promo: 3.99 },
        fulfillment: { curbside: true, delivery: true, instore: true },
        inventory: { stockLevel: "HIGH" },
      },
    ],
  },
};

export const mockLocationResults: LocationResultsContent = {
  _view: "search_locations",
  locations: [
    {
      locationId: "70500847",
      name: "QFC",
      chain: "QFC",
      address: {
        addressLine1: "2746 NE 45th St",
        city: "Seattle",
        state: "WA",
        zipCode: "98105",
      },
      phone: "206-523-5160",
    },
    {
      locationId: "70500848",
      name: "QFC",
      chain: "QFC",
      address: {
        addressLine1: "1401 Broadway",
        city: "Seattle",
        state: "WA",
        zipCode: "98122",
      },
      phone: "206-322-2280",
    },
  ],
};

export const mockLocationDetail: LocationDetailContent = {
  _view: "get_location_details",
  location: {
    locationId: "70500847",
    name: "QFC",
    chain: "QFC",
    address: {
      addressLine1: "2746 NE 45th St",
      city: "Seattle",
      state: "WA",
      zipCode: "98105",
    },
    phone: "206-523-5160",
    departments: [
      { name: "Bakery", phone: "206-523-5161" },
      { name: "Deli", phone: "206-523-5162" },
      { name: "Pharmacy", phone: "206-523-5163" },
    ],
  },
};

export const mockPantry: PantryListContent = {
  _view: "manage_pantry",
  items: [
    { productName: "Eggs", quantity: 12, addedAt: "2026-03-20" },
    {
      productName: "Milk",
      quantity: 1,
      addedAt: "2026-03-19",
      expiresAt: "2026-03-26",
    },
    { productName: "Butter", quantity: 2, addedAt: "2026-03-15" },
    {
      productName: "Spinach",
      quantity: 1,
      addedAt: "2026-03-21",
      expiresAt: "2026-03-23",
    },
  ],
  actionDetail: "4 items in pantry",
};

export const mockShoppingList: ShoppingListContent = {
  _view: "create_shopping_list",
  shopping_list_id: "user-123:session:dev-session:list:abc12345",
  name: "Tuesday Dinner",
  items: [
    {
      productName: "Organic Whole Milk",
      upc: "0001111042578",
      quantity: 2,
      notes: "1 gallon",
    },
    {
      productName: "Sourdough Bread",
      quantity: 1,
    },
    {
      productName: "Chicken Breast",
      upc: "0002100062282",
      quantity: 1,
      notes: "family pack",
    },
    {
      productName: "Strawberries",
      quantity: 2,
    },
  ],
  actionDetail: "4 items",
};

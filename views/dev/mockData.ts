import type {
  LocationDetailContent,
  LocationResultsContent,
  PantryListContent,
  ProductDetailContent,
  ProductSearchResultsContent,
  RecipeResultsContent,
  ShoppingListContent,
  WeeklyDealsContent,
} from "../shared/types.js";

export const mockWeeklyDeals: WeeklyDealsContent = {
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
  items: [
    {
      productName: "Organic Whole Milk",
      upc: "0001111042578",
      quantity: 2,
      notes: "1 gallon",
      checked: false,
      addedAt: "2026-03-22",
    },
    {
      productName: "Sourdough Bread",
      quantity: 1,
      checked: true,
      addedAt: "2026-03-21",
    },
    {
      productName: "Chicken Breast",
      upc: "0002100062282",
      quantity: 1,
      notes: "family pack",
      checked: false,
      addedAt: "2026-03-22",
    },
    {
      productName: "Strawberries",
      quantity: 2,
      checked: false,
      addedAt: "2026-03-22",
    },
  ],
  actionDetail: "3 unchecked items",
};

export const mockRecipes: RecipeResultsContent = {
  searchQuery: "pasta carbonara",
  recipes: [
    {
      title: "Classic Pasta Carbonara",
      description: "A traditional Roman pasta dish with eggs, cheese, and guanciale.",
      cuisine: "Italian",
      difficulty: "Medium",
      totalTime: 30,
      cookTime: 20,
      servings: "4",
      slug: "classic-pasta-carbonara",
      ingredients: [
        { quantity: "400", unit: "g", name: "spaghetti" },
        { quantity: "200", unit: "g", name: "guanciale or pancetta" },
        { quantity: "4", name: "egg yolks" },
        { quantity: "1", name: "whole egg" },
        { quantity: "100", unit: "g", name: "Pecorino Romano", notes: "finely grated" },
        { name: "black pepper", notes: "freshly ground, to taste" },
      ],
      instructions: [
        { stepNumber: 1, instruction: "Cook pasta in salted boiling water until al dente." },
        { stepNumber: 2, instruction: "Fry guanciale in a pan until crispy. Remove from heat." },
        { stepNumber: 3, instruction: "Whisk egg yolks, whole egg, and cheese together." },
        {
          stepNumber: 4,
          instruction: "Add hot pasta to the pan, then egg mixture off-heat. Toss quickly.",
        },
      ],
    },
  ],
};

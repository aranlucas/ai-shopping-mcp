import type { App } from "@modelcontextprotocol/ext-apps/react";

import { useState } from "react";

import { LocationDetailView } from "../app/views/LocationDetail.js";
import { LocationResultsView } from "../app/views/LocationResults.js";
import { PantryView } from "../app/views/Pantry.js";
import { ProductDetailView } from "../app/views/ProductDetail.js";
import { ProductSearchView } from "../app/views/ProductSearch.js";
import { RecipeResultsView } from "../app/views/RecipeResults.js";
import { ShoppingListView } from "../app/views/ShoppingList.js";
import { WeeklyDealsView } from "../app/views/WeeklyDeals.js";
import {
  mockLocationDetail,
  mockLocationResults,
  mockPantry,
  mockProductDetail,
  mockProductSearch,
  mockRecipes,
  mockShoppingList,
  mockWeeklyDeals,
} from "./mockData.js";

const VIEWS = [
  "weekly_deals",
  "search_products",
  "get_product_details",
  "search_locations",
  "get_location_details",
  "manage_shopping_list",
  "manage_pantry",
  "search_recipes_from_web",
] as const;

type ViewName = (typeof VIEWS)[number];

const LABELS: Record<ViewName, string> = {
  weekly_deals: "Weekly Deals",
  search_products: "Product Search",
  get_product_details: "Product Detail",
  search_locations: "Location Results",
  get_location_details: "Location Detail",
  manage_shopping_list: "Shopping List",
  manage_pantry: "Pantry",
  search_recipes_from_web: "Recipes",
};

// Mock App instance — buttons disabled (canCallTools=false), so this is never called.
const mockApp = null as unknown as App;

export function DevHarness() {
  const [activeView, setActiveView] = useState<ViewName>("weekly_deals");
  const [data, setData] = useState<unknown>(null);

  function renderView() {
    switch (activeView) {
      case "weekly_deals":
        return <WeeklyDealsView data={mockWeeklyDeals} app={mockApp} canCallTools={false} />;
      case "search_products":
        return <ProductSearchView data={mockProductSearch} app={mockApp} canCallTools={false} />;
      case "get_product_details":
        return <ProductDetailView data={mockProductDetail} app={mockApp} canCallTools={false} />;
      case "search_locations":
        return (
          <LocationResultsView data={mockLocationResults} app={mockApp} canCallTools={false} />
        );
      case "get_location_details":
        return <LocationDetailView data={mockLocationDetail} app={mockApp} canCallTools={false} />;
      case "manage_shopping_list":
        return (
          <ShoppingListView
            data={(data as typeof mockShoppingList) ?? mockShoppingList}
            setData={setData}
            app={mockApp}
            canCallTools={false}
          />
        );
      case "manage_pantry":
        return (
          <PantryView
            data={(data as typeof mockPantry) ?? mockPantry}
            setData={setData}
            app={mockApp}
            canCallTools={false}
          />
        );
      case "search_recipes_from_web":
        return <RecipeResultsView data={mockRecipes} />;
    }
  }

  function handleViewChange(view: ViewName) {
    setActiveView(view);
    setData(null);
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Dev toolbar */}
      <div className="bg-gray-900 text-white px-3 py-2 flex items-center gap-2 flex-wrap text-[11px]">
        <span className="font-mono text-yellow-400 font-semibold shrink-0">DEV</span>
        <div className="w-px h-3 bg-gray-600 shrink-0" />
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => handleViewChange(v)}
            className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer ${
              activeView === v ? "bg-white text-gray-900" : "text-gray-400 hover:text-white"
            }`}
          >
            {LABELS[v]}
          </button>
        ))}
      </div>

      {/* View */}
      <div className="flex-1 overflow-auto">{renderView()}</div>
    </div>
  );
}

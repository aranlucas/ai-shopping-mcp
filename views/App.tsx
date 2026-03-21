import { createRoot } from "react-dom/client";
import { ErrorDisplay, Loading } from "./shared/status.js";
import type {
  LocationDetailContent,
  LocationResultsContent,
  PantryListContent,
  ProductDetailContent,
  ProductSearchResultsContent,
  RecipeResultsContent,
  ShoppingListContent,
  WeeklyDealsContent,
} from "./shared/types.js";
import { useMcpApp } from "./app/use-mcp-app.js";
import { LocationDetailView } from "./app/views/LocationDetail.js";
import { LocationResultsView } from "./app/views/LocationResults.js";
import { PantryView } from "./app/views/Pantry.js";
import { ProductDetailView } from "./app/views/ProductDetail.js";
import { ProductSearchView } from "./app/views/ProductSearch.js";
import { RecipeResultsView } from "./app/views/RecipeResults.js";
import { ShoppingListView } from "./app/views/ShoppingList.js";
import { WeeklyDealsView } from "./app/views/WeeklyDeals.js";
import { StrictMode } from "react";

function App() {
  const { toolName, data, setData, app, isConnected, canCallTools, error } = useMcpApp();

  if (error) return <ErrorDisplay message={error.message} />;
  if (!isConnected || !data) return <Loading />;

  switch (toolName) {
    case "search_products":
      return (
        <ProductSearchView
          data={data as ProductSearchResultsContent}
          app={app}
          canCallTools={canCallTools}
        />
      );
    case "get_product_details":
      return (
        <ProductDetailView
          data={data as ProductDetailContent}
          app={app}
          canCallTools={canCallTools}
        />
      );
    case "search_locations":
      return (
        <LocationResultsView
          data={data as LocationResultsContent}
          app={app}
          canCallTools={canCallTools}
        />
      );
    case "get_location_details":
      return (
        <LocationDetailView
          data={data as LocationDetailContent}
          app={app}
          canCallTools={canCallTools}
        />
      );
    case "manage_shopping_list":
    case "checkout_shopping_list":
      return (
        <ShoppingListView
          data={data as ShoppingListContent}
          setData={setData}
          app={app}
          canCallTools={canCallTools}
        />
      );
    case "manage_pantry":
      return (
        <PantryView
          data={data as PantryListContent}
          setData={setData}
          app={app}
          canCallTools={canCallTools}
        />
      );
    case "search_recipes_from_web":
      return <RecipeResultsView data={data as RecipeResultsContent} />;
    case "get_weekly_deals":
      return (
        <WeeklyDealsView data={data as WeeklyDealsContent} app={app} canCallTools={canCallTools} />
      );
    default:
      return <Loading message={`Loading view for ${toolName ?? "unknown tool"}...`} />;
  }
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

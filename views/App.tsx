import {
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { StrictMode, useEffect, useState } from "react";
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
import { LocationDetailView } from "./app/views/LocationDetail.js";
import { LocationResultsView } from "./app/views/LocationResults.js";
import { PantryView } from "./app/views/Pantry.js";
import { ProductDetailView } from "./app/views/ProductDetail.js";
import { ProductSearchView } from "./app/views/ProductSearch.js";
import { RecipeResultsView } from "./app/views/RecipeResults.js";
import { ShoppingListView } from "./app/views/ShoppingList.js";
import { WeeklyDealsView } from "./app/views/WeeklyDeals.js";

function applyStyles(ctx: Partial<McpUiHostContext>) {
  if (ctx.theme === "light" || ctx.theme === "dark") {
    applyDocumentTheme(ctx.theme);
  }
  if (ctx.styles?.variables) {
    applyHostStyleVariables(ctx.styles.variables);
  }
  if (ctx.styles?.css?.fonts) {
    applyHostFonts(ctx.styles.css.fonts);
  }
}

function App() {
  const [toolName, setToolName] = useState<string | null>(null);
  const [data, setData] = useState<unknown>(null);

  const { app, isConnected, error } = useApp({
    appInfo: { name: "shopping-app", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (appInstance) => {
      appInstance.ontoolresult = (result) => {
        if (result.structuredContent) {
          setData(result.structuredContent);
          const ctxName = appInstance.getHostContext()?.toolInfo?.tool?.name;
          if (ctxName) setToolName(ctxName);
        }
      };
      appInstance.onerror = console.error;
      // NOTE: onhostcontextchanged is NOT set here. Setting it during onAppCreated
      // (which fires before connect() resolves) causes styles to be applied too
      // early on Android, breaking layout. It is set in useEffect below instead.
    },
  });

  // Set unified host context change handler via React lifecycle, not during connect.
  // Single handler for theme + variables + fonts + toolInfo avoids the useHostStyles
  // overwrite bug where useHostStyleVariables and useHostFonts each set
  // onhostcontextchanged and the second overwrites the first.
  useEffect(() => {
    if (!app) return;
    app.onhostcontextchanged = (params) => {
      const name = params.toolInfo?.tool?.name;
      if (name) setToolName(name);
      applyStyles(params);
    };
  }, [app]);

  // Apply initial styles and resolve tool name after connection.
  // getHostContext() returns the fully merged context (including any notifications
  // that fired between connect and this effect running), so nothing is missed.
  useEffect(() => {
    if (!app || !isConnected) return;
    const ctx = app.getHostContext();
    if (ctx) {
      applyStyles(ctx);
      const name = ctx.toolInfo?.tool?.name;
      if (name) setToolName((prev) => prev ?? name);
    }
  }, [app, isConnected]);

  const canCallTools = isConnected && !!app?.getHostCapabilities()?.serverTools;

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

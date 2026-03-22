/**
 * @file MCP Apps React view for the AI Shopping MCP server.
 */
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import {
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
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

function ShoppingApp() {
  const [toolResult, setToolResult] = useState<CallToolResult | null>(null);
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  const { app, error } = useApp({
    appInfo: { name: "shopping-app", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.onteardown = async () => {
        return {};
      };
      app.ontoolinput = async (input) => {
        console.info("Received tool call input:", input);
      };
      app.ontoolresult = async (result) => {
        console.info("Received tool call result:", result);
        setToolResult(result);
      };
      app.ontoolcancelled = (params) => {
        console.info("Tool call cancelled:", params.reason);
      };
      app.onerror = console.error;
      app.onhostcontextchanged = (params) => {
        setHostContext((prev) => ({ ...prev, ...params }));
      };
    },
  });

  useEffect(() => {
    if (app) {
      setHostContext(app.getHostContext());
    }
  }, [app]);

  if (error) return <ErrorDisplay message={error.message} />;
  if (!app) return <Loading />;

  return <ShoppingAppInner app={app} toolResult={toolResult} hostContext={hostContext} />;
}

interface ShoppingAppInnerProps {
  app: App;
  toolResult: CallToolResult | null;
  hostContext?: McpUiHostContext;
}

function ShoppingAppInner({ app, toolResult, hostContext }: ShoppingAppInnerProps) {
  const [data, setData] = useState<unknown>(null);

  useEffect(() => {
    if (toolResult?.structuredContent) {
      setData(toolResult.structuredContent);
    }
  }, [toolResult]);

  useEffect(() => {
    if (!hostContext) return;
    if (hostContext.theme === "light" || hostContext.theme === "dark") {
      applyDocumentTheme(hostContext.theme);
    }
    if (hostContext.styles?.variables) {
      applyHostStyleVariables(hostContext.styles.variables);
    }
    if (hostContext.styles?.css?.fonts) {
      applyHostFonts(hostContext.styles.css.fonts);
    }
  }, [hostContext]);

  const toolName = hostContext?.toolInfo?.tool?.name ?? null;
  const canCallTools = !!app.getHostCapabilities()?.serverTools;

  if (!data) return <Loading />;

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
    <ShoppingApp />
  </StrictMode>,
);

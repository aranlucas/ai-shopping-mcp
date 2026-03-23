/**
 * @file MCP Apps React view for the AI Shopping MCP server.
 */
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ErrorDisplay, Loading } from "./shared/status.js";
import { parseStructuredContent, type AppData } from "./shared/types.js";
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
  const [partialArgs, setPartialArgs] = useState<Record<string, unknown> | null>(null);
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  const { app, error } = useApp({
    appInfo: { name: "shopping-app", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.onteardown = async () => {
        return {};
      };
      app.ontoolinputpartial = (params) => {
        setPartialArgs(params.arguments ?? {});
      };
      app.ontoolinput = async (input) => {
        console.info("Received tool call input:", input);
        setPartialArgs(null);
      };
      app.ontoolresult = async (result) => {
        console.info("Received tool call result:", result);
        setPartialArgs(null);
        setToolResult(result);
      };
      app.ontoolcancelled = (params) => {
        console.info("Tool call cancelled:", params);
        setPartialArgs(null);
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

  useHostStyles(app, app?.getHostContext());

  if (error) return <ErrorDisplay message={error.message} />;
  if (!app) return <Loading />;

  return (
    <ShoppingAppInner
      app={app}
      toolResult={toolResult}
      partialArgs={partialArgs}
      hostContext={hostContext}
    />
  );
}

interface ShoppingAppInnerProps {
  app: App;
  toolResult: CallToolResult | null;
  partialArgs: Record<string, unknown> | null;
  hostContext?: McpUiHostContext;
}

function getPartialLoadingMessage(viewKey: string | null, args: Record<string, unknown>): string {
  switch (viewKey) {
    case "search_products": {
      const terms = args.terms as string[] | undefined;
      if (terms?.length) return `Searching for ${terms.join(", ")}…`;
      return "Searching products…";
    }
    case "get_product_details":
      return "Loading product…";
    case "search_locations":
      return "Searching locations…";
    case "get_location_details":
      return "Loading location…";
    case "manage_shopping_list": {
      const action = args.action as string | undefined;
      if (action === "add") return "Adding to shopping list…";
      if (action === "remove") return "Removing from shopping list…";
      if (action === "clear") return "Clearing shopping list…";
      if (action === "update") return "Updating shopping list…";
      return "Updating shopping list…";
    }
    case "checkout_shopping_list":
      return "Checking out…";
    case "manage_pantry": {
      const action = args.action as string | undefined;
      if (action === "add") return "Adding to pantry…";
      if (action === "remove") return "Removing from pantry…";
      if (action === "clear") return "Clearing pantry…";
      return "Updating pantry…";
    }
    case "get_weekly_deals":
      return "Fetching weekly deals…";
    case "search_recipes_from_web":
      return "Searching recipes…";
    default:
      return "Loading…";
  }
}

function ShoppingAppInner({ app, toolResult, partialArgs, hostContext }: ShoppingAppInnerProps) {
  const [data, setData] = useState<AppData | null>(null);

  useEffect(() => {
    if (toolResult?.structuredContent) {
      setData(parseStructuredContent(toolResult.structuredContent));
    }
  }, [toolResult]);

  const toolName = hostContext?.toolInfo?.tool?.name ?? null;
  const canCallTools = !!app.getHostCapabilities()?.serverTools;

  if (!data) {
    const message = partialArgs ? getPartialLoadingMessage(toolName, partialArgs) : undefined;
    return <Loading message={message} />;
  }

  switch (data._view) {
    case "search_products":
      return <ProductSearchView data={data} app={app} canCallTools={canCallTools} />;
    case "get_product_details":
      return <ProductDetailView data={data} app={app} canCallTools={canCallTools} />;
    case "search_locations":
      return (
        <LocationResultsView data={data} setData={setData} app={app} canCallTools={canCallTools} />
      );
    case "get_location_details":
      return <LocationDetailView data={data} app={app} canCallTools={canCallTools} />;
    case "manage_shopping_list":
      return (
        <ShoppingListView data={data} setData={setData} app={app} canCallTools={canCallTools} />
      );
    case "manage_pantry":
      return <PantryView data={data} setData={setData} app={app} canCallTools={canCallTools} />;
    case "search_recipes_from_web":
      return <RecipeResultsView data={data} />;
    case "get_weekly_deals":
      return <WeeklyDealsView data={data} app={app} canCallTools={canCallTools} />;
  }
}

createRoot(document.getElementById("root") as HTMLElement).render(<ShoppingApp />);

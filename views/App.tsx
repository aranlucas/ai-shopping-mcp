/**
 * @file MCP Apps React view for the AI Shopping MCP server.
 */
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { LocationDetailView } from "./app/views/LocationDetail.js";
import { LocationResultsView } from "./app/views/LocationResults.js";
import { OrderHistoryView } from "./app/views/OrderHistory.js";
import { PantryView } from "./app/views/Pantry.js";
import { ProductDetailView } from "./app/views/ProductDetail.js";
import { ProductSearchView } from "./app/views/ProductSearch.js";
import { ShoppingListView } from "./app/views/ShoppingList.js";
import { WeeklyDealsView } from "./app/views/WeeklyDeals.js";
import { useResettableState } from "./shared/hooks.js";
import {
  ErrorDisplay,
  ListSkeleton,
  Loading,
  ProductSearchSkeleton,
  WeeklyDealsSkeleton,
} from "./shared/status.js";
import { parseStructuredContent } from "./shared/types.js";

function ShoppingApp() {
  const [toolResult, setToolResult] = useState<CallToolResult | null>(null);
  const [partialArgs, setPartialArgs] = useState<Record<string, unknown> | null>(null);
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  const { app, isConnected, error } = useApp({
    appInfo: { name: "shopping-app", version: "1.0.0" },
    capabilities: { availableDisplayModes: ["inline", "fullscreen"] },
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
  if (!isConnected || !app) return <Loading />;

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
    default:
      return "Loading…";
  }
}

function ShoppingAppInner({ app, toolResult, partialArgs, hostContext }: ShoppingAppInnerProps) {
  // `data` is seeded from `toolResult` but child views edit it locally (optimistic
  // updates via `setData`), so it isn't purely derived — we can't compute it inline.
  // `useResettableState` re-seeds it during render whenever a new tool result
  // arrives, which is what React recommends instead of a re-syncing Effect.
  const [data, setData] = useResettableState(toolResult, (result) =>
    parseStructuredContent(result?.structuredContent),
  );

  const toolName = hostContext?.toolInfo?.tool?.name ?? null;
  const canCallTools = !!app.getHostCapabilities()?.serverTools;

  if (!data) {
    if (partialArgs) {
      switch (toolName) {
        case "search_products":
          return <ProductSearchSkeleton />;
        case "get_weekly_deals":
          return <WeeklyDealsSkeleton />;
        case "manage_shopping_list":
        case "manage_pantry":
        case "mark_order_placed":
          return <ListSkeleton />;
        default: {
          const message = getPartialLoadingMessage(toolName, partialArgs);
          return <Loading message={message} />;
        }
      }
    }
    return <Loading />;
  }

  switch (data._view) {
    case "search_products":
      return (
        <ProductSearchView
          data={data}
          app={app}
          canCallTools={canCallTools}
          hostContext={hostContext}
        />
      );
    case "get_product_details":
      return <ProductDetailView data={data} app={app} canCallTools={canCallTools} />;
    case "search_locations":
      return (
        <LocationResultsView
          data={data}
          setData={setData}
          app={app}
          canCallTools={canCallTools}
          hostContext={hostContext}
        />
      );
    case "get_location_details":
      return <LocationDetailView data={data} app={app} canCallTools={canCallTools} />;
    case "manage_shopping_list":
      return (
        <ShoppingListView data={data} setData={setData} app={app} canCallTools={canCallTools} />
      );
    case "manage_pantry":
      return <PantryView data={data} setData={setData} app={app} canCallTools={canCallTools} />;
    case "get_weekly_deals":
      return (
        <WeeklyDealsView
          data={data}
          app={app}
          canCallTools={canCallTools}
          hostContext={hostContext}
        />
      );
    case "mark_order_placed":
      return <OrderHistoryView data={data} />;
    default:
      // `parseStructuredContent` only yields known views, so this is unreachable
      // — but it keeps the switch exhaustive and avoids a silent blank render.
      return <ErrorDisplay message="This result can't be displayed." />;
  }
}

createRoot(document.getElementById("root") as HTMLElement).render(<ShoppingApp />);

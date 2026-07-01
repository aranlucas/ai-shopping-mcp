/**
 * @file MCP Apps React view for the AI Shopping MCP server.
 */
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { AddToCartView } from "./app/views/add-to-cart.js";
import { KitchenEquipmentView } from "./app/views/kitchen-equipment.js";
import { LocationDetailView } from "./app/views/location-detail.js";
import { LocationResultsView } from "./app/views/location-results.js";
import { OrderHistoryView } from "./app/views/order-history.js";
import { PantryView } from "./app/views/pantry.js";
import { ProductDetailView } from "./app/views/product-detail.js";
import { ProductSearchView } from "./app/views/product-search.js";
import { ShoppingListView } from "./app/views/shopping-list.js";
import { WeeklyDealsView } from "./app/views/weekly-deals.js";
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
    case "get_product":
      return "Loading product…";
    case "search_stores":
      return "Searching stores…";
    case "get_store":
      return "Loading store…";
    case "create_shopping_list":
      return "Creating shopping list…";
    case "add_shopping_list_to_cart":
      return "Adding to cart…";
    case "add_pantry_items":
      return "Adding to pantry…";
    case "remove_pantry_items":
      return "Removing from pantry…";
    case "clear_pantry":
      return "Clearing pantry…";
    case "add_kitchen_equipment":
      return "Adding kitchen equipment…";
    case "remove_kitchen_equipment":
      return "Removing kitchen equipment…";
    case "clear_kitchen_equipment":
      return "Clearing kitchen equipment…";
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
        case "create_shopping_list":
        case "add_pantry_items":
        case "remove_pantry_items":
        case "clear_pantry":
        case "add_kitchen_equipment":
        case "remove_kitchen_equipment":
        case "clear_kitchen_equipment":
        case "record_order":
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
    case "get_product":
      return <ProductDetailView data={data} app={app} canCallTools={canCallTools} />;
    case "search_stores":
      return (
        <LocationResultsView
          data={data}
          setData={setData}
          app={app}
          canCallTools={canCallTools}
          hostContext={hostContext}
        />
      );
    case "get_store":
      return <LocationDetailView data={data} app={app} canCallTools={canCallTools} />;
    case "create_shopping_list":
      return <ShoppingListView data={data} app={app} canCallTools={canCallTools} />;
    case "add_shopping_list_to_cart":
      return <AddToCartView data={data} />;
    case "pantry":
      return <PantryView data={data} setData={setData} app={app} canCallTools={canCallTools} />;
    case "kitchen_equipment":
      return (
        <KitchenEquipmentView data={data} setData={setData} app={app} canCallTools={canCallTools} />
      );
    case "get_weekly_deals":
      return (
        <WeeklyDealsView
          data={data}
          app={app}
          canCallTools={canCallTools}
          hostContext={hostContext}
        />
      );
    case "record_order":
      return <OrderHistoryView data={data} />;
    default:
      // `parseStructuredContent` only yields known views, so this is unreachable
      // — but it keeps the switch exhaustive and avoids a silent blank render.
      return <ErrorDisplay message="This result can't be displayed." />;
  }
}

createRoot(document.getElementById("root") as HTMLElement).render(<ShoppingApp />);

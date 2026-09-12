/// <reference types="vite/client" />
/** Local fixture preview. Excluded from the production HTML entry in vite.config.ts. */
import type { App } from "@modelcontextprotocol/ext-apps/react";
import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  appResult,
  type ProductSearchResultsContent,
  type ShoppingListContent,
  type WeeklyDealsContent,
} from "../src/app-results.js";
import { ProductSearchView } from "./app/views/product-search.js";
import { ShoppingListView } from "./app/views/shopping-list.js";
import { WeeklyDealsView } from "./app/views/weekly-deals.js";
import { ErrorDisplay, ProductSearchSkeleton } from "./shared/status.js";
import type { ToolCall } from "./shared/types.js";

const PRODUCTS: ProductSearchResultsContent = {
  view: "search_products",
  totalProducts: 4,
  results: [
    {
      provider: "kroger",
      term: "Strawberries",
      failed: false,
      products: [
        {
          product: { provider: "kroger", id: "preview-1" },
          name: "Fresh Organic Strawberries",
          brand: "Simple Truth Organic",
          size: "1 lb",
          price: 3.99,
          regularPrice: 5.49,
          available: true,
          pickup: true,
          aisle: { description: "Produce" },
        },
        {
          product: { provider: "kroger", id: "preview-2" },
          name: "Fresh Strawberries, Family Size",
          size: "2 lb",
          price: 6.99,
          available: true,
          pickup: true,
        },
        {
          product: { provider: "kroger", id: "preview-3" },
          name: "Frozen Unsweetened Whole Strawberries",
          size: "16 oz",
          available: true,
          imageUrl: "data:image/png;base64,broken",
        },
        {
          product: { provider: "kroger", id: "preview-4" },
          name: "Chocolate Dipped Strawberries",
          size: "6 ct",
          price: 8.99,
          available: false,
        },
      ],
    },
  ],
};
const DEALS: WeeklyDealsContent = {
  view: "get_weekly_deals",
  validFrom: "Sep 9",
  validTill: "Sep 15",
  cache: { state: "fresh" },
  deals: [
    {
      title: "Fresh Strawberries",
      category: "Produce",
      price: "$2.99",
      savings: "Save $2",
      details: "1 lb package. With card. Limit 4 at this price.",
    },
    {
      title: "Hass Avocados",
      category: "Produce",
      price: "3 for $5",
      details: "Medium size. Sold individually.",
    },
    {
      title: "Organic Baby Spinach",
      category: "Produce",
      price: "$3.49",
      savings: "Save $1",
      details: "5 oz package. Simple Truth Organic.",
    },
    {
      title: "Boneless Skinless Chicken Breasts",
      category: "Meat & Seafood",
      price: "$2.49/lb",
      details: "Family pack. With card. Price varies by package weight.",
    },
    {
      title: "Atlantic Salmon Fillets",
      category: "Meat & Seafood",
      price: "$8.99/lb",
      savings: "Save $3/lb",
      details: "Farm raised. Fresh from the seafood counter.",
    },
    {
      title: "Greek Yogurt",
      category: "Dairy & Eggs",
      price: "10 for $10",
      details: "5.3 oz. Select varieties. Must buy 10 to receive this price.",
    },
  ],
};
const LIST: ShoppingListContent = {
  view: "create_shopping_list",
  listId: "preview-list",
  name: "Dinner for the week",
  items: [
    {
      productName: "Fresh organic strawberries",
      product: { provider: "kroger", id: "preview-1" },
      quantity: 2,
      notes: "Choose ripe berries for breakfast and the spinach salad.",
    },
    {
      productName: "Boneless skinless chicken breasts, family pack",
      product: { provider: "kroger", id: "preview-chicken" },
      quantity: 1,
      notes: "Enough for two dinners. Freeze half after shopping.",
    },
    {
      productName: "Greek yogurt, plain and unsweetened",
      product: { provider: "kroger", id: "preview-yogurt" },
      quantity: 3,
    },
    {
      productName: "Trader Joe’s brown jasmine rice",
      product: { provider: "traderjoes", id: "preview-rice" },
      quantity: 1,
      notes: "Keep this item on the list until a Kroger alternative is selected.",
    },
    {
      productName: "A large bunch of fresh herbs for the weekend meal",
      quantity: 1,
      notes: "Parsley or cilantro. Avoid the small plastic packets if a fresh bunch is available.",
    },
  ],
};

function Preview() {
  const [view, setView] = useState("deals");
  const [theme, setTheme] = useState("light");
  const [fail, setFail] = useState(false);
  const [lastAction, setLastAction] = useState("No actions yet.");
  const handleView = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => setView(event.target.value),
    [],
  );
  const handleTheme = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => setTheme(event.target.value),
    [],
  );
  const handleFail = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setFail(event.target.checked),
    [],
  );
  useEffect(() => {
    document.documentElement.style.colorScheme = theme;
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);
  const app = useMemo(
    () =>
      ({
        callServerTool: async (call: ToolCall) => {
          setLastAction(`Calling ${call.name}…`);
          await new Promise((resolve) => setTimeout(resolve, 600));
          if (fail)
            return {
              content: [
                {
                  type: "text",
                  text: "Preview: your session expired. Reconnect your account and try again.",
                },
              ],
              isError: true,
            };
          setLastAction(`Completed ${call.name}.`);
          if (call.name === "search_products")
            return { content: [], ...appResult("search_products", PRODUCTS) };
          if (call.name === "create_shopping_list")
            return { content: [], structuredContent: { listId: "preview-created-list" } };
          return { content: [] };
        },
        sendMessage: async () => {
          setLastAction("Asking assistant…");
          await new Promise((resolve) => setTimeout(resolve, 600));
          if (fail) return { isError: true };
          setLastAction("Message received by preview assistant.");
          return {};
        },
        updateModelContext: async () => ({}),
      }) as unknown as App,
    [fail],
  );
  const staleDeals = useMemo(
    () => ({
      ...DEALS,
      cache: { state: "stale" as const },
      warnings: [
        "The latest refresh failed. Showing saved deals; check the offer dates before shopping.",
      ],
    }),
    [],
  );
  const emptyDeals = useMemo(() => ({ ...DEALS, deals: [] }), []);
  const failedProducts = useMemo(
    () => ({
      ...PRODUCTS,
      totalProducts: 0,
      results: [{ provider: "kroger", term: "Strawberries", failed: true, products: [] }],
    }),
    [],
  );

  return (
    <>
      <div className="border-b border-border bg-muted px-4 py-3 text-sm">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-4">
          <strong>Local preview · sample data</strong>
          <label className="flex items-center gap-2">
            View{" "}
            <select
              aria-label="Preview view"
              value={view}
              onChange={handleView}
              className="rounded border border-border bg-background p-1"
            >
              <option value="deals">Weekly deals</option>
              <option value="stale">Stale deals</option>
              <option value="products">Products</option>
              <option value="list">Shopping list</option>
              <option value="empty">Empty deals</option>
              <option value="failed">Failed search</option>
              <option value="loading">Loading</option>
              <option value="error">Tool error</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            Theme{" "}
            <select
              aria-label="Preview theme"
              value={theme}
              onChange={handleTheme}
              className="rounded border border-border bg-background p-1"
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={fail} onChange={handleFail} />
            Fail actions
          </label>
        </div>
        <output className="mx-auto mt-2 block max-w-4xl text-xs text-gray-500">
          {lastAction} Uses a simulated host; no account or cart is changed.
        </output>
      </div>
      <main key={view}>
        {view === "deals" && <WeeklyDealsView data={DEALS} app={app} canCallTools />}
        {view === "stale" && <WeeklyDealsView data={staleDeals} app={app} canCallTools />}
        {view === "empty" && <WeeklyDealsView data={emptyDeals} app={app} canCallTools />}
        {view === "products" && <ProductSearchView data={PRODUCTS} app={app} canCallTools />}
        {view === "failed" && <ProductSearchView data={failedProducts} app={app} canCallTools />}
        {view === "list" && <ShoppingListView data={LIST} app={app} canCallTools />}
        {view === "loading" && <ProductSearchSkeleton />}
        {view === "error" && (
          <ErrorDisplay message="Your session expired. Reconnect your account and ask your assistant to try again." />
        )}
      </main>
    </>
  );
}

if (import.meta.env.DEV) {
  const root = createRoot(document.getElementById("root") as HTMLElement);
  root.render(<Preview />);
  import.meta.hot?.dispose(() => root.unmount());
}

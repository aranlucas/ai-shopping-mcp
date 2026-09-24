/// <reference types="vite/client" />
/** Local fixture preview. Excluded from the production HTML entry in vite.config.ts. */
import type { App } from "@modelcontextprotocol/ext-apps/react";
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  type AppData,
  appResult,
  type CartViewContent,
  type ProductSearchResultsContent,
  type ShoppingListContent,
  type ShoppingListsContent,
  type WeeklyDealsContent,
} from "../src/app-results.js";
import { CartView } from "./app/views/cart.js";
import { ProductSearchView } from "./app/views/product-search.js";
import { ShoppingListView } from "./app/views/shopping-list.js";
import { ShoppingListsView } from "./app/views/shopping-lists.js";
import { WeeklyDealsView } from "./app/views/weekly-deals.js";
import { ErrorDisplay, ProductSearchSkeleton } from "./shared/status.js";
import type { ToolCall } from "./shared/types.js";

const PRODUCTS: ProductSearchResultsContent = {
  view: "search_products",
  totalProducts: 4,
  results: [
    {
      term: "Strawberries",
      failed: false,
      products: [
        {
          upc: "0001111000001",
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
          upc: "0001111000002",
          name: "Fresh Strawberries, Family Size",
          size: "2 lb",
          price: 6.99,
          available: true,
          pickup: true,
        },
        {
          upc: "0001111000003",
          name: "Frozen Unsweetened Whole Strawberries",
          size: "16 oz",
          available: true,
          imageUrl: "data:image/png;base64,broken",
        },
        {
          upc: "0001111000004",
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
      id: "item-1",
      checked: false,
      productName: "Fresh organic strawberries",
      upc: "0001111000001",
      price: 3.99,
      quantity: 2,
      notes: "Choose ripe berries for breakfast and the spinach salad.",
    },
    {
      id: "item-2",
      checked: false,
      productName: "Boneless skinless chicken breasts, family pack",
      upc: "0001111000005",
      price: 11.49,
      quantity: 1,
      notes: "Enough for two dinners. Freeze half after shopping.",
    },
    {
      id: "item-3",
      checked: true,
      productName: "Greek yogurt, plain and unsweetened",
      upc: "0001111000006",
      quantity: 3,
    },
    {
      id: "item-4",
      checked: false,
      productName: "Brown jasmine rice",
      quantity: 1,
      notes: "Keep this item on the list until a product is selected.",
    },
    {
      id: "item-5",
      checked: false,
      productName: "A large bunch of fresh herbs for the weekend meal",
      quantity: 1,
      notes:
        "Parsley or cilantro. Avoid the small plastic packets if a fresh bunch is available.",
    },
  ],
};

const LISTS: ShoppingListsContent = {
  view: "shopping_lists",
  lists: [
    {
      id: "preview-list",
      name: "Dinner for the week",
      itemCount: 5,
      updatedAt: "2026-09-20T18:00:00.000Z",
    },
    {
      id: "preview-list-2",
      name: "Saturday brunch",
      itemCount: 3,
      updatedAt: "2026-09-18T09:00:00.000Z",
    },
  ],
};
const CART: CartViewContent = {
  view: "view_cart",
  source: "assistant",
  items: [
    {
      upc: "0001111000001",
      productName: "Fresh organic strawberries",
      quantity: 2,
      modality: "PICKUP",
    },
    {
      upc: "0001111000005",
      productName: "Boneless skinless chicken breasts, family pack",
      quantity: 1,
      modality: "PICKUP",
    },
    {
      upc: "0001111000001",
      productName: "Fresh organic strawberries",
      quantity: 1,
      modality: "PICKUP",
    },
  ],
};

/** Applies a simulated list edit so the preview behaves like the server. */
function editPreviewList(
  list: ShoppingListContent,
  args: Extract<ToolCall, { name: "edit_shopping_list_item" }>["arguments"],
): ShoppingListContent {
  if (args.remove)
    return {
      ...list,
      items: list.items.filter((item) => item.id !== args.itemId),
    };
  return {
    ...list,
    items: list.items.map((item) =>
      item.id === args.itemId
        ? {
            ...item,
            ...(args.checked === undefined ? {} : { checked: args.checked }),
            ...(args.quantity === undefined
              ? {}
              : { quantity: Number(args.quantity) }),
          }
        : item,
    ),
  };
}

function Preview() {
  const [view, setView] = useState("deals");
  const [theme, setTheme] = useState("light");
  const [fail, setFail] = useState(false);
  const [unknownCart, setUnknownCart] = useState(false);
  const handleUnknownCart = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      setUnknownCart(event.target.checked),
    [],
  );
  const [lastAction, setLastAction] = useState("No actions yet.");
  const [listData, setListData] = useState<AppData | null>(LIST);
  const listRef = useRef<ShoppingListContent>(LIST);
  const handleView = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value;
    setView(next);
    listRef.current = LIST;
    setListData(next === "lists" ? LISTS : LIST);
  }, []);
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
          if (unknownCart && call.name === "add_shopping_list_to_cart")
            return {
              content: [
                {
                  type: "text",
                  text: "Preview: cart confirmation was lost. Check your Kroger cart before adding again.",
                },
              ],
              isError: true,
              structuredContent: {
                error: {
                  code: "MUTATION_OUTCOME_UNKNOWN",
                  recovery: "check_cart",
                },
              },
            };
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
            return {
              content: [],
              structuredContent: { listId: "preview-created-list" },
            };
          if (call.name === "get_shopping_list")
            return call.arguments.listId
              ? {
                  content: [],
                  ...appResult("create_shopping_list", listRef.current),
                }
              : { content: [], ...appResult("shopping_lists", LISTS) };
          if (call.name === "add_shopping_list_items")
            return {
              content: [],
              ...appResult("create_shopping_list", listRef.current),
            };
          if (call.name === "edit_shopping_list_item") {
            listRef.current = editPreviewList(listRef.current, call.arguments);
            return {
              content: [],
              ...appResult("create_shopping_list", listRef.current),
            };
          }
          if (call.name === "record_order")
            return {
              content: [],
              ...appResult("record_order", {
                orderId: "preview-order",
                items: [],
                totalItems: 0,
                placedAt: new Date().toISOString(),
              }),
            };
          if (call.name === "remove_from_inventory")
            return {
              content: [],
              ...appResult("pantry", { items: [] }),
            };
          if (call.name === "add_shopping_list_to_cart")
            return {
              content: [],
              ...appResult("add_shopping_list_to_cart", {
                outcome: "added",
                addedCount: 1,
                requestedCount: 1,
                listId: "preview-list",
                name: "Preview cart",
                items: [
                  {
                    upc: "0001111042578",
                    quantity: 1,
                    modality: "PICKUP",
                  },
                ],
                needsUpc: [],
                actionDetail: "Added 1 item(s) to cart",
              }),
            };
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
    [fail, unknownCart],
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
      results: [
        {
          term: "Strawberries",
          failed: true,
          products: [],
        },
      ],
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
              <option value="lists">All lists</option>
              <option value="cart">Cart</option>
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
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={unknownCart}
              onChange={handleUnknownCart}
            />
            Unknown cart outcome
          </label>
        </div>
        <output className="mx-auto mt-2 block max-w-4xl text-xs text-gray-500">
          {lastAction} Uses a simulated host; no account or cart is changed.
        </output>
      </div>
      <main key={view}>
        {view === "deals" && (
          <WeeklyDealsView data={DEALS} app={app} canCallTools />
        )}
        {view === "stale" && (
          <WeeklyDealsView data={staleDeals} app={app} canCallTools />
        )}
        {view === "empty" && (
          <WeeklyDealsView data={emptyDeals} app={app} canCallTools />
        )}
        {view === "products" && (
          <ProductSearchView data={PRODUCTS} app={app} canCallTools />
        )}
        {view === "failed" && (
          <ProductSearchView data={failedProducts} app={app} canCallTools />
        )}
        {(view === "list" || view === "lists") &&
          listData?.view === "create_shopping_list" && (
            <ShoppingListView
              data={listData}
              setData={setListData}
              app={app}
              canCallTools
            />
          )}
        {(view === "list" || view === "lists") &&
          listData?.view === "shopping_lists" && (
            <ShoppingListsView
              data={listData}
              setData={setListData}
              app={app}
              canCallTools
            />
          )}
        {view === "cart" && <CartView data={CART} app={app} />}
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

import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge } from "../shared/components.js";
import { ErrorDisplay, Loading } from "../shared/status.js";
import {
  callTool,
  type ShoppingListContent,
  type ShoppingListItemData,
} from "../shared/types.js";
import { useMcpView } from "../shared/use-mcp-view.js";

function ShoppingItem({
  item,
  onRemove,
}: {
  item: ShoppingListItemData;
  onRemove: (name: string) => Promise<void>;
}) {
  const [removing, setRemoving] = useState(false);

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await onRemove(item.productName);
    } catch {
      setRemoving(false);
    }
  };

  return (
    <div
      className={`bg-white rounded-xl p-4 border border-gray-200/80 shadow-sm transition-all duration-200 dark:bg-gray-800 dark:border-gray-700/80 ${
        item.checked || removing
          ? "opacity-50"
          : "hover:shadow-md hover:border-gray-300/80 dark:hover:border-gray-600/80"
      }`}
    >
      <div className="flex justify-between items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`text-base ${item.checked ? "text-emerald-500" : "text-gray-300 dark:text-gray-600"}`}
            >
              {item.checked ? "\u2611" : "\u2610"}
            </span>
            <span
              className={`font-semibold text-sm ${item.checked ? "line-through text-gray-400 dark:text-gray-500" : "text-gray-900 dark:text-gray-100"}`}
            >
              {item.productName}
              {removing && (
                <span className="text-xs text-gray-400 ml-2">Removing...</span>
              )}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1.5 ml-6">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Qty: {item.quantity}
            </span>
            {item.upc ? (
              <Badge variant="green">UPC</Badge>
            ) : (
              <Badge variant="yellow">Needs UPC</Badge>
            )}
            {item.upc && (
              <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">
                {item.upc}
              </span>
            )}
          </div>
          {item.notes && (
            <div className="text-xs text-gray-400 dark:text-gray-500 italic mt-1 ml-6">
              {item.notes}
            </div>
          )}
        </div>
        {!item.checked && (
          <button
            type="button"
            disabled={removing}
            className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors dark:hover:bg-red-950 disabled:opacity-40"
            onClick={handleRemove}
          >
            <svg
              aria-hidden="true"
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18 18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

function ShoppingListView() {
  const { data, setData, app, isConnected, error } =
    useMcpView<ShoppingListContent>("shopping-list", (sc) => !!sc?.items);

  if (error) return <ErrorDisplay message={error.message} />;
  if (!isConnected || !data) return <Loading />;

  const { items, actionDetail } = data;

  const handleRemove = async (name: string) => {
    const result = await callTool(app, {
      name: "manage_shopping_list",
      arguments: { action: "remove", productName: name },
    });
    if (result?.isError) {
      throw new Error("Failed to remove item");
    }
    const updated = result?.structuredContent as
      | ShoppingListContent
      | undefined;
    if (updated?.items) {
      setData(updated);
    }
  };

  if (items.length === 0) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6">
          Shopping List
        </h1>
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <svg
            aria-hidden="true"
            className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z"
            />
          </svg>
          <p className="text-sm">Your shopping list is empty</p>
        </div>
      </div>
    );
  }

  const unchecked = items.filter((i) => !i.checked);
  const checked = items.filter((i) => i.checked);
  const withUpc = unchecked.filter((i) => i.upc);
  const withoutUpc = unchecked.filter((i) => !i.upc);

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
        Shopping List
      </h1>
      {actionDetail && (
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {actionDetail}
        </p>
      )}

      <div className="flex gap-2 mt-3 mb-5 flex-wrap">
        <Badge variant="blue">{unchecked.length} to buy</Badge>
        <Badge variant="green">{withUpc.length} ready</Badge>
        {withoutUpc.length > 0 && (
          <Badge variant="yellow">{withoutUpc.length} need UPC</Badge>
        )}
        {checked.length > 0 && (
          <Badge variant="gray">{checked.length} in cart</Badge>
        )}
      </div>

      <div className="space-y-2">
        {unchecked.map((item) => (
          <ShoppingItem
            key={item.productName}
            item={item}
            onRemove={handleRemove}
          />
        ))}
      </div>

      {checked.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">
            In Cart ({checked.length})
          </h2>
          <div className="space-y-2">
            {checked.map((item) => (
              <ShoppingItem
                key={item.productName}
                item={item}
                onRemove={handleRemove}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <ShoppingListView />,
);

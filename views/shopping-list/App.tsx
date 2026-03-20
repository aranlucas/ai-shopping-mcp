import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ActionButton, Badge } from "../shared/components.js";
import { EmptyState, ErrorDisplay, Loading } from "../shared/status.js";
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
  const [removeState, setRemoveState] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");

  const handleRemove = async () => {
    setRemoveState("loading");
    try {
      await onRemove(item.productName);
      setRemoveState("done");
    } catch {
      setRemoveState("error");
      setTimeout(() => setRemoveState("idle"), 2000);
    }
  };

  const isDimmed = item.checked || removeState !== "idle";

  return (
    <div
      className={`flex items-start gap-3 px-3.5 py-3 rounded-xl border transition-all duration-150 ${
        item.checked
          ? "bg-gray-50/50 border-gray-100 dark:bg-gray-800/30 dark:border-gray-700/30"
          : "bg-white border-gray-200/60 shadow-sm dark:bg-gray-800/80 dark:border-gray-700/60"
      } ${isDimmed ? "opacity-50" : ""}`}
    >
      {/* Checkbox visual */}
      <div
        className={`mt-0.5 shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
          item.checked
            ? "bg-emerald-500 border-emerald-500 dark:bg-emerald-600 dark:border-emerald-600"
            : "border-gray-300 dark:border-gray-600"
        }`}
      >
        {item.checked && (
          <svg
            aria-hidden="true"
            className="w-2.5 h-2.5 text-white"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={3}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m4.5 12.75 6 6 9-13.5"
            />
          </svg>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div
          className={`text-sm font-medium leading-snug ${
            item.checked
              ? "line-through text-gray-400 dark:text-gray-500"
              : "text-gray-900 dark:text-gray-100"
          }`}
        >
          {item.productName}
        </div>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className="text-xs text-gray-400 dark:text-gray-500">
            ×{item.quantity}
          </span>
          {item.upc ? (
            <Badge variant="green">UPC</Badge>
          ) : (
            <Badge variant="yellow">No UPC</Badge>
          )}
          {item.notes && (
            <span className="text-xs text-gray-400 dark:text-gray-500 italic truncate max-w-32">
              {item.notes}
            </span>
          )}
        </div>
      </div>

      {/* Remove button */}
      {!item.checked && (
        <ActionButton
          state={removeState}
          onClick={handleRemove}
          idleLabel=""
          loadingLabel=""
          doneLabel=""
          failLabel=""
          variant="secondary"
          icon={
            <svg
              aria-label="Remove"
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18 18 6M6 6l12 12"
              />
            </svg>
          }
        />
      )}
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
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 tracking-tight mb-1">
          Shopping List
        </h1>
        <EmptyState
          icon={
            <svg
              aria-hidden="true"
              className="w-6 h-6"
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
          }
          message="Your shopping list is empty"
          description="Add items from product search results."
        />
      </div>
    );
  }

  const unchecked = items.filter((i) => !i.checked);
  const checked = items.filter((i) => i.checked);
  const withUpc = unchecked.filter((i) => i.upc);
  const withoutUpc = unchecked.filter((i) => !i.upc);

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="mb-4">
        <div className="flex items-center gap-2.5">
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 tracking-tight">
            Shopping List
          </h1>
          <Badge variant="blue">{unchecked.length} to buy</Badge>
        </div>
        {actionDetail && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {actionDetail}
          </p>
        )}
      </div>

      {/* Summary row */}
      <div className="flex gap-1.5 mb-4 flex-wrap">
        <Badge variant="green">{withUpc.length} ready</Badge>
        {withoutUpc.length > 0 && (
          <Badge variant="yellow">{withoutUpc.length} need UPC</Badge>
        )}
        {checked.length > 0 && (
          <Badge variant="gray">{checked.length} in cart</Badge>
        )}
      </div>

      <div className="space-y-1.5">
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
          <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
            In Cart ({checked.length})
          </p>
          <div className="space-y-1.5">
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

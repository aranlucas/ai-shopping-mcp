import type { App } from "@modelcontextprotocol/ext-apps/react";
import { useState } from "react";
import { ActionButton, Badge, SectionHeader } from "../../shared/components.js";
import { EmptyState } from "../../shared/status.js";
import {
  callTool,
  parseStructuredContent,
  type AppData,
  type ShoppingListContent,
  type ShoppingListItemData,
} from "../../shared/types.js";

function ShoppingItem({
  item,
  canCallTools,
  onRemove,
}: {
  item: ShoppingListItemData;
  canCallTools: boolean;
  onRemove: (name: string) => Promise<void>;
}) {
  const [removeState, setRemoveState] = useState<"idle" | "loading" | "done" | "error">("idle");

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

  return (
    <div
      className={`flex items-center gap-2.5 py-2.5 transition-opacity duration-150 ${removeState !== "idle" || item.checked ? "opacity-40" : ""}`}
    >
      {/* Checkbox indicator */}
      <div
        className={`shrink-0 w-3.5 h-3.5 rounded-sm border-2 flex items-center justify-center transition-colors ${
          item.checked ? "bg-emerald-500 border-emerald-500" : "border-gray-300"
        }`}
      >
        {item.checked && (
          <svg
            aria-hidden="true"
            className="w-2 h-2 text-white"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={3.5}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div
          className={`text-[13px] font-medium leading-snug truncate ${item.checked ? "line-through text-gray-400" : "text-gray-900"}`}
        >
          {item.productName}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <span className="text-[11px] text-gray-400 font-mono">×{item.quantity}</span>
          {item.upc ? <Badge variant="green">UPC</Badge> : <Badge variant="yellow">No UPC</Badge>}
          {item.notes && (
            <span className="text-[11px] text-gray-400 italic truncate max-w-28">{item.notes}</span>
          )}
        </div>
      </div>

      {/* Remove */}
      {!item.checked && (
        <ActionButton
          state={removeState}
          onClick={handleRemove}
          disabled={!canCallTools}
          idleLabel=""
          loadingLabel=""
          doneLabel=""
          failLabel=""
          variant="secondary"
          icon={
            <svg
              aria-label="Remove"
              className="w-3 h-3"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2.5}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          }
        />
      )}
    </div>
  );
}

export function ShoppingListView({
  data,
  setData,
  app,
  canCallTools,
}: {
  data: ShoppingListContent;
  setData: (data: AppData | null) => void;
  app: App | null;
  canCallTools: boolean;
}) {
  const { items, actionDetail } = data;

  const handleRemove = async (name: string) => {
    const result = await callTool(app, {
      name: "manage_shopping_list",
      arguments: { action: "remove", productName: name },
    });
    if (result?.isError) throw new Error("Failed to remove item");
    const updated = parseStructuredContent(result?.structuredContent);
    if (updated) setData(updated);
  };

  if (items.length === 0) {
    return (
      <div className="px-3.5 py-3 max-w-2xl mx-auto animate-view-in">
        <h1 className="text-sm font-semibold text-gray-900 tracking-tight mb-1">Shopping List</h1>
        <EmptyState
          icon={
            <svg
              aria-hidden="true"
              className="w-5 h-5"
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
    <div className="px-3.5 py-3 max-w-2xl mx-auto animate-view-in">
      <SectionHeader
        title="Shopping List"
        badge={
          <span className="text-[11px] text-gray-400 font-mono">{unchecked.length} to buy</span>
        }
        subtitle={actionDetail}
      />

      {/* Status chips */}
      <div className="flex gap-1.5 mb-3 flex-wrap">
        <Badge variant="green">{withUpc.length} ready</Badge>
        {withoutUpc.length > 0 && <Badge variant="yellow">{withoutUpc.length} need UPC</Badge>}
        {checked.length > 0 && <Badge variant="gray">{checked.length} in cart</Badge>}
      </div>

      {/* Unchecked items */}
      <div className="divide-y divide-[var(--app-border)]">
        {unchecked.map((item) => (
          <ShoppingItem
            key={item.productName}
            item={item}
            canCallTools={canCallTools}
            onRemove={handleRemove}
          />
        ))}
      </div>

      {/* Checked items */}
      {checked.length > 0 && (
        <div className="mt-5">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
            In Cart · {checked.length}
          </p>
          <div className="divide-y divide-[var(--app-border)]">
            {checked.map((item) => (
              <ShoppingItem
                key={item.productName}
                item={item}
                canCallTools={canCallTools}
                onRemove={handleRemove}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

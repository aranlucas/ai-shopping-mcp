import type { App } from "@modelcontextprotocol/ext-apps/react";

import { useState } from "react";

import { Badge } from "@/shared/ui/badge.js";

import { SectionHeader } from "../../shared/components.js";
import { EmptyState } from "../../shared/status.js";
import {
  type ShoppingListContent,
  type ShoppingListItemData,
  callTool,
  sendUserMessage,
} from "../../shared/types.js";
import { addShoppingListToCartCall, toolResultErrorMessage } from "../tool-calls.js";

function ShoppingItem({ item }: { item: ShoppingListItemData }) {
  return (
    <div className="flex items-center gap-2.5 py-2.5">
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium leading-snug truncate text-gray-900">
          {item.productName}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <span className="text-[11px] text-gray-400 font-mono">×{item.quantity}</span>
          {item.upc && <Badge variant="green">UPC ready</Badge>}
          {item.notes && (
            <span className="text-[11px] text-gray-400 italic truncate max-w-28">{item.notes}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function ShoppingListView({
  data,
  app,
  canCallTools,
}: {
  data: ShoppingListContent;
  app: App | null;
  canCallTools: boolean;
}) {
  const { name, items, shopping_list_id } = data;
  const [checkoutState, setCheckoutState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <div className="px-3.5 py-3 max-w-2xl mx-auto animate-view-in">
        <SectionHeader
          title={name || "Shopping List"}
          badge={
            <span className="text-[11px] text-gray-400 font-mono truncate max-w-32">
              {shopping_list_id}
            </span>
          }
        />
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
          message="This shopping list is empty"
          description="Add items from product search results."
        />
      </div>
    );
  }

  const withUpc = items.filter((i) => i.upc);
  const withoutUpc = items.filter((i) => !i.upc);

  const handleCheckout = async () => {
    setCheckoutState("loading");
    setCheckoutError(null);

    try {
      const result = await callTool(app, addShoppingListToCartCall(shopping_list_id, "PICKUP"));
      if (result?.isError) {
        throw new Error(toolResultErrorMessage(result, "Failed to add shopping list to cart"));
      }
      setCheckoutState("done");
      setTimeout(() => setCheckoutState("idle"), 2000);
    } catch (error) {
      setCheckoutState("error");
      setCheckoutError(
        error instanceof Error ? error.message : "Failed to add shopping list to cart",
      );
      setTimeout(() => {
        setCheckoutState("idle");
        setCheckoutError(null);
      }, 5000);
    }
  };

  const handleFindUpcs = () => {
    const names = withoutUpc.map((i) => i.productName).join(", ");
    sendUserMessage(app, `Find UPCs for these items on my shopping list: ${names}.`);
  };

  return (
    <div className="px-3.5 py-3 max-w-2xl mx-auto animate-view-in">
      <SectionHeader
        title={name || "Shopping List"}
        badge={
          <span className="text-[11px] text-gray-400 font-mono truncate max-w-32">
            {shopping_list_id}
          </span>
        }
        subtitle={`${items.length} item${items.length === 1 ? "" : "s"}`}
      />

      {/* Status summary */}
      <div className="flex gap-1.5 mb-3 flex-wrap">
        <Badge variant="green">{withUpc.length} ready</Badge>
        {withoutUpc.length > 0 && <Badge variant="yellow">{withoutUpc.length} need UPC</Badge>}
      </div>

      {/* Quick actions */}
      {canCallTools && (withUpc.length > 0 || withoutUpc.length > 0) && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {withUpc.length > 0 && (
            <button
              type="button"
              onClick={handleCheckout}
              disabled={checkoutState === "loading"}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium bg-[var(--app-accent)] hover:bg-[var(--app-accent-hover)] text-white border-0 cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <svg
                aria-hidden="true"
                className="w-3 h-3"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z"
                />
              </svg>
              {checkoutState === "loading"
                ? "Adding..."
                : checkoutState === "done"
                  ? "Added"
                  : checkoutState === "error"
                    ? "Failed"
                    : `Check out ${withUpc.length} item${withUpc.length === 1 ? "" : "s"}`}
            </button>
          )}
          {withoutUpc.length > 0 && (
            <button
              type="button"
              onClick={handleFindUpcs}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium border border-border text-gray-600 hover:bg-muted bg-transparent cursor-pointer transition-colors"
            >
              <svg
                aria-hidden="true"
                className="w-3 h-3"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                />
              </svg>
              Find missing UPCs
            </button>
          )}
        </div>
      )}

      {checkoutError && <div className="mb-3 text-[11px] text-red-600">{checkoutError}</div>}

      {/* Items */}
      <div className="divide-y divide-border">
        {items.map((item) => (
          <ShoppingItem key={item.productName} item={item} />
        ))}
      </div>
    </div>
  );
}

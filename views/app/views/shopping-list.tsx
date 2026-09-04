import type { App } from "@modelcontextprotocol/ext-apps/react";

import { useCallback, useMemo, useState } from "react";

import { Badge } from "@agents/ui/components/badge";

import { SectionHeader } from "../../shared/components.js";
import { EmptyState } from "../../shared/status.js";
import {
  type ShoppingListContent,
  type ShoppingListItemData,
  callTool,
  sendUserMessage,
} from "../../shared/types.js";
import { addShoppingListToCartCall, toolResultErrorMessage } from "../tool-calls.js";

const EMPTY_LIST_ICON = (
  <svg
    aria-hidden="true"
    className="size-5"
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
);

function ShoppingItem({ item }: { item: ShoppingListItemData }) {
  return (
    <div className="flex items-center gap-2.5 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm leading-snug font-medium text-gray-900">
          {item.productName}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-xs text-gray-400">×{item.quantity}</span>
          {item.product && (
            <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">
              {item.product.provider}
            </Badge>
          )}
          {item.notes && (
            <span className="max-w-28 truncate text-xs text-gray-400 italic">{item.notes}</span>
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
  const { name, items, listId } = data;
  const [checkoutState, setCheckoutState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const withUpc = useMemo(
    () =>
      items.filter((item) => item.product?.provider === "kroger" || (!item.product && item.upc)),
    [items],
  );
  const withoutUpc = useMemo(
    () => items.filter((item) => !withUpc.includes(item)),
    [items, withUpc],
  );

  const handleCheckout = useCallback(async () => {
    setCheckoutState("loading");
    setCheckoutError(null);

    try {
      const result = await callTool(app, addShoppingListToCartCall(listId, "PICKUP"));
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
  }, [app, listId]);

  const handleFindUpcs = useCallback(() => {
    const names = withoutUpc.map((i) => i.productName).join(", ");
    sendUserMessage(app, `Find Kroger matches for these items on my shopping list: ${names}.`);
  }, [app, withoutUpc]);

  const headerBadge = useMemo(
    () => <span className="max-w-32 truncate font-mono text-xs text-gray-400">{listId}</span>,
    [listId],
  );

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl animate-in px-3.5 py-3 fade-in slide-in-from-bottom-1">
        <SectionHeader title={name || "Shopping List"} badge={headerBadge} />
        <EmptyState
          icon={EMPTY_LIST_ICON}
          message="This shopping list is empty"
          description="Add items from product search results."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl animate-in px-3.5 py-3 fade-in slide-in-from-bottom-1">
      <SectionHeader
        title={name || "Shopping List"}
        badge={headerBadge}
        subtitle={`${items.length} item${items.length === 1 ? "" : "s"}`}
      />

      {/* Status summary */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">
          {withUpc.length} ready
        </Badge>
        {withoutUpc.length > 0 && (
          <Badge variant="outline" className="bg-amber-50 text-amber-700">
            {withoutUpc.length} need UPC
          </Badge>
        )}
      </div>

      {/* Quick actions */}
      {canCallTools && (withUpc.length > 0 || withoutUpc.length > 0) && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {withUpc.length > 0 && (
            <button
              type="button"
              onClick={handleCheckout}
              disabled={checkoutState === "loading"}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-primary px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <svg
                aria-hidden="true"
                className="size-3"
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
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-transparent px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-muted"
            >
              <svg
                aria-hidden="true"
                className="size-3"
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

      {checkoutError && <div className="mb-3 text-xs text-red-600">{checkoutError}</div>}

      {/* Items */}
      <div className="divide-y divide-border">
        {items.map((item) => (
          <ShoppingItem key={item.productName} item={item} />
        ))}
      </div>
    </div>
  );
}

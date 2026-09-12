import type { App } from "@modelcontextprotocol/ext-apps/react";
import { useCallback, useMemo } from "react";
import { Badge } from "@agents/ui/components/badge";
import { ActionButton, SectionHeader } from "../../shared/components.js";
import { useResettableState } from "../../shared/hooks.js";
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
  const ready = item.product?.provider === "kroger" || (!item.product && !!item.upc);
  return (
    <li className="flex items-start gap-4 py-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm leading-relaxed font-medium wrap-break-word text-gray-900">
          {item.productName}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {item.product && <span className="text-xs text-gray-500">{item.product.provider}</span>}
          {!ready && (
            <Badge variant="outline" className="bg-amber-50 text-amber-700">
              Needs Kroger match
            </Badge>
          )}
        </div>
        {item.notes && (
          <p className="mt-1.5 text-sm leading-relaxed wrap-break-word text-gray-500">
            {item.notes}
          </p>
        )}
      </div>
      <span
        aria-label={`Quantity: ${item.quantity}`}
        className="shrink-0 rounded-md bg-muted px-2.5 py-1 text-sm font-medium text-gray-700 tabular-nums"
      >
        ×{item.quantity}
      </span>
    </li>
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
  const [cartState, setCartState] = useResettableState(
    data,
    (): "idle" | "loading" | "done" | "error" => "idle",
  );
  const [cartError, setCartError] = useResettableState(data, (): string | null => null);
  const [matchState, setMatchState] = useResettableState(
    data,
    (): "idle" | "loading" | "done" | "error" => "idle",
  );
  const [matchError, setMatchError] = useResettableState(data, (): string | null => null);
  const readyItems = useMemo(
    () =>
      items.filter((item) => item.product?.provider === "kroger" || (!item.product && item.upc)),
    [items],
  );
  const unmatchedItems = useMemo(
    () => items.filter((item) => !readyItems.includes(item)),
    [items, readyItems],
  );

  const handleAddToCart = useCallback(async () => {
    setCartState("loading");
    setCartError(null);
    try {
      const result = await callTool(app, addShoppingListToCartCall(listId, "PICKUP"));
      if (result?.isError)
        throw new Error(toolResultErrorMessage(result, "Failed to add shopping list to cart"));
      setCartState("done");
    } catch (error) {
      setCartState("error");
      setCartError(error instanceof Error ? error.message : "Failed to add shopping list to cart");
    }
  }, [app, listId, setCartState, setCartError]);

  const handleFindMatches = useCallback(async () => {
    setMatchState("loading");
    setMatchError(null);
    try {
      const names = unmatchedItems.map((item) => item.productName).join(", ");
      await sendUserMessage(
        app,
        `Find Kroger matches for these items on my shopping list: ${names}.`,
      );
      setMatchState("done");
    } catch (error) {
      setMatchState("error");
      setMatchError(
        error instanceof Error ? error.message : "Could not ask the assistant. Try again.",
      );
    }
  }, [app, unmatchedItems, setMatchState, setMatchError]);

  const headerBadge = useMemo(
    () => <Badge variant="secondary">{items.length} items</Badge>,
    [items.length],
  );

  return (
    <div className="mx-auto max-w-2xl px-4 py-5 sm:px-6">
      <SectionHeader title={name || "Shopping List"} badge={headerBadge} />
      {items.length === 0 ? (
        <EmptyState
          icon={EMPTY_LIST_ICON}
          message="This shopping list is empty"
          description="Add items from product search results."
        />
      ) : (
        <>
          <div className="mb-2 border-b border-border pb-5">
            <p className="mb-3 text-sm text-gray-600">
              {readyItems.length} of {items.length} items ready for your Kroger pickup cart.
              {unmatchedItems.length > 0 && ` ${unmatchedItems.length} still need a Kroger match.`}
            </p>
            <div className="flex flex-wrap gap-2">
              {readyItems.length > 0 && (
                <ActionButton
                  state={cartState}
                  onClick={handleAddToCart}
                  disabled={!canCallTools || cartState === "done"}
                  idleLabel={`Add ${readyItems.length} ${readyItems.length === 1 ? "item" : "items"} to cart`}
                  loadingLabel="Adding to cart…"
                  doneLabel="Added to cart"
                  failLabel="Retry adding to cart"
                />
              )}
              {unmatchedItems.length > 0 && (
                <ActionButton
                  state={matchState}
                  onClick={handleFindMatches}
                  disabled={!app || matchState === "done"}
                  idleLabel="Find Kroger matches"
                  loadingLabel="Asking assistant…"
                  doneLabel="Asked assistant"
                  failLabel="Retry finding matches"
                  variant="secondary"
                />
              )}
            </div>
            {cartState === "done" && (
              <output className="mt-3 block text-sm text-emerald-700">
                Added to your pickup cart. Review your cart in Kroger to complete your purchase.
              </output>
            )}
            {cartError && (
              <p role="alert" className="mt-3 text-sm text-red-600">
                {cartError}
              </p>
            )}
            {matchError && (
              <p role="alert" className="mt-3 text-sm text-red-600">
                {matchError}
              </p>
            )}
            {!canCallTools && (
              <p className="mt-3 text-sm text-gray-500">
                Ask your assistant to add these items to your cart.
              </p>
            )}
          </div>
          <ul className="m-0 list-none divide-y divide-border p-0">
            {items.map((item) => (
              <ShoppingItem key={item.productName} item={item} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

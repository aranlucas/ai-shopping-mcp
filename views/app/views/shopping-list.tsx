import type { App } from "@modelcontextprotocol/ext-apps/react";
import {
  type ChangeEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { estimateListTotal } from "../../../src/domain/list-total.js";
import { Badge } from "../../shared/ui/badge";
import { Button } from "../../shared/ui/button";
import {
  ActionButton,
  CartActionControl,
  SectionHeader,
} from "../../shared/components.js";
import { useResettableState } from "../../shared/hooks.js";
import { EmptyState } from "../../shared/status.js";
import {
  type AppData,
  type ShoppingListContent,
  type ShoppingListItemData,
  sendUserMessage,
} from "../../shared/types.js";
import { editShoppingListItem, recordPurchase } from "../tool-calls.js";
import { useCartAction } from "../use-cart-action.js";

const MAX_QUANTITY = 999;

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

const REMOVE_ICON = (
  <svg
    aria-hidden="true"
    className="size-3"
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
);

function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

type ItemEdit = Omit<
  Parameters<typeof editShoppingListItem>[1],
  "listId" | "itemId"
>;

function applyItemEdit(
  list: ShoppingListContent,
  itemId: string,
  edit: ItemEdit,
): ShoppingListContent {
  if (edit.remove)
    return { ...list, items: list.items.filter((item) => item.id !== itemId) };
  return {
    ...list,
    items: list.items.map((item) =>
      item.id === itemId
        ? {
            ...item,
            ...(edit.checked === undefined ? {} : { checked: edit.checked }),
            ...(edit.quantity === undefined
              ? {}
              : { quantity: Number(edit.quantity) }),
          }
        : item,
    ),
  };
}

function ShoppingItemRow({
  item,
  canEdit,
  onEdit,
}: {
  item: ShoppingListItemData;
  canEdit: boolean;
  onEdit: (itemId: string, edit: ItemEdit) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const itemId = item.id;
  const editable = canEdit && itemId !== undefined && !pending;
  const name = item.productName;

  const apply = useCallback(
    async (edit: ItemEdit) => {
      if (itemId === undefined) return;
      setPending(true);
      setError(null);
      try {
        await onEdit(itemId, edit);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not update the list");
      } finally {
        setPending(false);
      }
    },
    [itemId, onEdit],
  );

  // `apply` reports its own failures; the catch only guards the DOM boundary.
  const run = useCallback(
    (edit: ItemEdit) => {
      apply(edit).catch(console.error);
    },
    [apply],
  );
  const handleChecked = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      run({ checked: event.target.checked }),
    [run],
  );
  const handleDecrease = useCallback(
    () => run({ quantity: item.quantity - 1 }),
    [run, item.quantity],
  );
  const handleIncrease = useCallback(
    () => run({ quantity: item.quantity + 1 }),
    [run, item.quantity],
  );
  const handleRemove = useCallback(() => run({ remove: true }), [run]);

  const checkboxId = `list-item-${itemId ?? name}`;
  const checked = item.checked === true;

  return (
    <li
      className={`flex items-start gap-3 py-3 transition-opacity ${checked ? "opacity-50" : ""} ${pending ? "opacity-60" : ""}`}
    >
      <input
        id={checkboxId}
        type="checkbox"
        checked={checked}
        disabled={!editable}
        onChange={handleChecked}
        className="mt-1 size-4 shrink-0 accent-primary"
      />
      <div className="min-w-0 flex-1">
        <label
          htmlFor={checkboxId}
          className={`block text-sm leading-relaxed font-medium wrap-break-word text-gray-900 ${checked ? "line-through" : ""}`}
        >
          {name}
        </label>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {!item.upc && (
            <Badge variant="outline" tone="warning">
              Needs Kroger match
            </Badge>
          )}
          {item.price !== undefined && (
            <span className="text-xs text-gray-500 tabular-nums">
              {formatMoney(item.price)} each
              {item.quantity > 1 &&
                ` · ${formatMoney(item.price * item.quantity)}`}
            </span>
          )}
        </div>
        {item.notes && (
          <p className="mt-1.5 text-sm leading-relaxed wrap-break-word text-gray-500">
            {item.notes}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-1.5 text-sm text-red-600">
            {error}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="outline"
          size="icon-xs"
          aria-label={`Decrease quantity of ${name}`}
          disabled={!editable || item.quantity <= 1}
          onClick={handleDecrease}
        >
          −
        </Button>
        <output
          aria-label={`Quantity of ${name}`}
          className="min-w-7 text-center text-sm font-medium text-gray-700 tabular-nums"
        >
          {item.quantity}
        </output>
        <Button
          variant="outline"
          size="icon-xs"
          aria-label={`Increase quantity of ${name}`}
          disabled={!editable || item.quantity >= MAX_QUANTITY}
          onClick={handleIncrease}
        >
          +
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Remove ${name}`}
          disabled={!editable}
          onClick={handleRemove}
        >
          {REMOVE_ICON}
        </Button>
      </div>
    </li>
  );
}

export function ShoppingListView({
  data,
  setData,
  app,
  canCallTools,
}: {
  data: ShoppingListContent;
  setData?: (data: AppData | null) => void;
  app: App | null;
  canCallTools: boolean;
}) {
  const { name, items, listId } = data;
  const cart = useCartAction(app, { kind: "list", listId, modality: "PICKUP" });
  // Keyed by list, not by list contents: editing an item must not re-enable
  // an action that already ran (for example recording the purchase twice).
  const [matchState, setMatchState] = useResettableState(
    listId,
    (): "idle" | "loading" | "done" | "error" => "idle",
  );
  const [matchError, setMatchError] = useResettableState(
    listId,
    (): string | null => null,
  );
  const [purchaseState, setPurchaseState] = useResettableState(
    listId,
    (): "idle" | "loading" | "done" | "error" => "idle",
  );
  const [purchaseError, setPurchaseError] = useResettableState(
    listId,
    (): string | null => null,
  );

  const readyItems = useMemo(
    () => items.filter((item) => Boolean(item.upc)),
    [items],
  );
  const unmatchedItems = useMemo(
    () => items.filter((item) => !item.upc),
    [items],
  );
  // Checked items sink to the bottom so the list reads as what's left to buy.
  const sortedItems = useMemo(
    () => [
      ...items.filter((item) => !item.checked),
      ...items.filter((item) => item.checked),
    ],
    [items],
  );
  const checkedCount = useMemo(
    () => items.filter((item) => item.checked).length,
    [items],
  );
  const { total, pricedCount } = useMemo(
    () => estimateListTotal(items),
    [items],
  );

  // Show the edit immediately, then adopt the server's list; roll back if the
  // edit fails so the row never shows a change that wasn't saved.
  // Only the newest edit's response is applied, so responses that arrive out
  // of order cannot replace a newer list with an older one.
  const latestEdit = useRef(0);
  const handleEdit = useCallback(
    async (itemId: string, edit: ItemEdit) => {
      const editNumber = ++latestEdit.current;
      setData?.(applyItemEdit(data, itemId, edit));
      try {
        const updated = await editShoppingListItem(app, {
          listId,
          itemId,
          ...edit,
        });
        if (editNumber === latestEdit.current) setData?.(updated);
      } catch (error) {
        if (editNumber === latestEdit.current) setData?.(data);
        throw error;
      }
    },
    [app, data, listId, setData],
  );

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
        error instanceof Error
          ? error.message
          : "Could not ask the assistant. Try again.",
      );
    }
  }, [app, unmatchedItems, setMatchState, setMatchError]);

  const handleMarkPurchased = useCallback(async () => {
    setPurchaseState("loading");
    setPurchaseError(null);
    try {
      await recordPurchase(app, readyItems);
      setPurchaseState("done");
    } catch (error) {
      setPurchaseState("error");
      setPurchaseError(
        error instanceof Error ? error.message : "Could not record purchase",
      );
    }
  }, [app, readyItems, setPurchaseState, setPurchaseError]);

  const headerBadge = useMemo(
    () => (
      <span className="flex flex-wrap gap-1.5">
        <Badge variant="secondary">{items.length} items</Badge>
        {pricedCount > 0 && (
          <Badge variant="secondary" tone="info">
            ~{formatMoney(total)} est.
          </Badge>
        )}
      </span>
    ),
    [items.length, pricedCount, total],
  );

  const canEdit = canCallTools && setData !== undefined;
  const cartDone =
    cart.state.status === "added" || cart.state.status === "already_added";

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
              {readyItems.length} of {items.length} items ready for your Kroger
              pickup cart.
              {unmatchedItems.length > 0 &&
                ` ${unmatchedItems.length} still need a Kroger match.`}
              {checkedCount > 0 && ` ${checkedCount} checked off.`}
              {pricedCount > 0 &&
                pricedCount < items.length &&
                ` Estimate covers ${pricedCount} priced items.`}
            </p>
            <div className="flex flex-wrap gap-2">
              {readyItems.length > 0 && (
                <CartActionControl
                  app={app}
                  state={cart.state}
                  onSubmit={cart.submit}
                  disabled={!canCallTools}
                  idleLabel={`Add ${readyItems.length} ${readyItems.length === 1 ? "item" : "items"} to cart`}
                  loadingLabel="Adding to cart…"
                  doneLabel="Added to cart"
                  failLabel="Retry adding to cart"
                />
              )}
              {cartDone && (
                <ActionButton
                  state={purchaseState}
                  onClick={handleMarkPurchased}
                  disabled={!canCallTools || purchaseState === "done"}
                  idleLabel="Mark as purchased"
                  loadingLabel="Recording…"
                  doneLabel="Recorded"
                  failLabel="Retry recording"
                  variant="secondary"
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
            {cart.state.status === "added" && (
              <output className="mt-3 block text-sm text-emerald-700">
                Added to your pickup cart. Review your cart in Kroger to
                complete your purchase, then mark it as purchased here.
              </output>
            )}
            {purchaseState === "done" && (
              <output className="mt-3 block text-sm text-emerald-700">
                Recorded in your order history.
              </output>
            )}
            {purchaseError && (
              <p role="alert" className="mt-3 text-sm text-red-600">
                {purchaseError}
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
            {sortedItems.map((item, index) => (
              <ShoppingItemRow
                key={item.id ?? `${index}:${item.productName}`}
                item={item}
                canEdit={canEdit}
                onEdit={handleEdit}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

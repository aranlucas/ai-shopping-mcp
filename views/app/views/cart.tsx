import type { App } from "@modelcontextprotocol/ext-apps/react";
import { useMemo } from "react";
import { Badge } from "../../shared/ui/badge";
import { CartCheckLink, SectionHeader } from "../../shared/components.js";
import { EmptyState } from "../../shared/status.js";
import type { CartViewContent, CartViewItemData } from "../../shared/types.js";

const EMPTY_CART_ICON = (
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

export function CartView({
  data,
  app,
}: {
  data: CartViewContent;
  app: App | null;
}) {
  const { source, note } = data;
  // The assistant mirror records each add separately; show one line per
  // product and fulfillment method.
  const items = useMemo(() => {
    const grouped = new Map<string, CartViewItemData>();
    for (const item of data.items) {
      const key = `${item.upc}:${item.modality ?? ""}`;
      const existing = grouped.get(key);
      grouped.set(
        key,
        existing
          ? { ...existing, quantity: existing.quantity + item.quantity }
          : item,
      );
    }
    return [...grouped.values()];
  }, [data.items]);
  const units = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity, 0),
    [items],
  );
  const headerBadge = useMemo(
    () => (
      <Badge variant="secondary">
        {units} {units === 1 ? "unit" : "units"}
      </Badge>
    ),
    [units],
  );
  const subtitle =
    source === "live"
      ? "Live from your Kroger cart"
      : "Items added through your assistant. Changes made in the Kroger app aren't shown.";

  return (
    <div className="mx-auto max-w-2xl px-4 py-5 sm:px-6">
      <SectionHeader
        title="Kroger cart"
        badge={headerBadge}
        subtitle={subtitle}
      />
      {note && <p className="mb-3 text-sm text-gray-600">{note}</p>}
      {items.length === 0 ? (
        <EmptyState
          icon={EMPTY_CART_ICON}
          message="Nothing in the cart yet"
          description="Ask your assistant to shop for items or add a list to your cart."
        />
      ) : (
        <ul className="m-0 list-none divide-y divide-border p-0">
          {items.map((item) => (
            <li
              key={`${item.upc}:${item.modality ?? ""}`}
              className="flex items-center gap-3 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-gray-900">
                  {item.productName ?? item.upc}
                </div>
                {item.modality && (
                  <div className="mt-0.5 text-xs text-gray-500">
                    {item.modality === "DELIVERY" ? "Delivery" : "Pickup"}
                  </div>
                )}
              </div>
              <span className="shrink-0 rounded-md bg-muted px-2.5 py-1 text-sm font-medium text-gray-700 tabular-nums">
                ×{item.quantity}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4">
        <CartCheckLink app={app} label="Open Kroger cart to check out" />
      </div>
    </div>
  );
}

import { Badge } from "@agents/ui/components/badge";

import type { AddShoppingListToCartContent } from "../../shared/types.js";

import { SectionHeader } from "../../shared/components.js";
import { EmptyState } from "../../shared/status.js";

export function AddToCartView({ data }: { data: AddShoppingListToCartContent }) {
  const { listId, name, items, needsUpc, actionDetail } = data;
  const title = `Cart · ${name}`;

  const headerBadge = listId ? (
    <span className="max-w-32 truncate font-mono text-xs text-gray-400">{listId}</span>
  ) : undefined;

  if (items.length === 0 && needsUpc.length === 0) {
    return (
      <div className="mx-auto max-w-2xl animate-in px-3.5 py-3 fade-in slide-in-from-bottom-1">
        <SectionHeader title={title} badge={headerBadge} />
        <EmptyState
          icon={
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
          }
          message="No items in the cart"
          description="Add items with UPCs to your shopping list, then call add_shopping_list_to_cart."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl animate-in px-3.5 py-3 fade-in slide-in-from-bottom-1">
      <SectionHeader title={title} badge={headerBadge} subtitle={actionDetail} />

      {items.length > 0 && (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">
              {items.length} added
            </Badge>
            {needsUpc.length > 0 && (
              <Badge variant="outline" className="bg-amber-50 text-amber-700">
                {needsUpc.length} need UPC
              </Badge>
            )}
          </div>

          <div className="divide-y divide-border">
            {items.map((item) => (
              <div key={item.upc} className="flex items-center gap-2.5 py-2.5">
                <div className="flex size-3.5 shrink-0 items-center justify-center rounded-sm border-2 border-emerald-500 bg-emerald-500">
                  <svg
                    aria-hidden="true"
                    className="size-2 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={3.5}
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm leading-snug font-medium text-gray-900">
                    {item.productName ?? item.upc}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className="font-mono text-xs text-gray-400">×{item.quantity}</span>
                    <span className="font-mono text-xs text-gray-400">{item.modality}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {needsUpc.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-semibold tracking-wider text-gray-400 uppercase">
            Need a UPC · {needsUpc.length}
          </p>
          <div className="divide-y divide-border">
            {needsUpc.map((item) => (
              <div key={item.productName} className="flex items-center gap-2.5 py-2.5 opacity-60">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm leading-snug font-medium text-gray-700">
                    {item.productName}
                  </div>
                  <span className="font-mono text-xs text-gray-400">×{item.quantity}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

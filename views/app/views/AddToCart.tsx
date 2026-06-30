import { Badge } from "@/shared/ui/badge.js";

import type { AddToCartContent } from "../../shared/types.js";

import { SectionHeader } from "../../shared/components.js";
import { EmptyState } from "../../shared/status.js";

export function AddToCartView({ data }: { data: AddToCartContent }) {
  const { shopping_list_id, name, items, needsUpc, actionDetail } = data;
  const title = `Cart · ${name}`;

  const headerBadge = (
    <span className="text-[11px] text-gray-400 font-mono truncate max-w-32">
      {shopping_list_id}
    </span>
  );

  if (items.length === 0 && needsUpc.length === 0) {
    return (
      <div className="px-3.5 py-3 max-w-2xl mx-auto animate-view-in">
        <SectionHeader title={title} badge={headerBadge} />
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
          message="No items in the cart"
          description="Add items with UPCs to your shopping list, then call add_to_cart."
        />
      </div>
    );
  }

  return (
    <div className="px-3.5 py-3 max-w-2xl mx-auto animate-view-in">
      <SectionHeader title={title} badge={headerBadge} subtitle={actionDetail} />

      {items.length > 0 && (
        <>
          <div className="flex gap-1.5 mb-3 flex-wrap">
            <Badge variant="green">{items.length} added</Badge>
            {needsUpc.length > 0 && <Badge variant="yellow">{needsUpc.length} need UPC</Badge>}
          </div>

          <div className="divide-y divide-border">
            {items.map((item) => (
              <div key={item.upc} className="flex items-center gap-2.5 py-2.5">
                <div className="shrink-0 w-3.5 h-3.5 rounded-sm bg-emerald-500 border-2 border-emerald-500 flex items-center justify-center">
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
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium leading-snug truncate text-gray-900">
                    {item.productName ?? item.upc}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[11px] text-gray-400 font-mono">×{item.quantity}</span>
                    <span className="text-[11px] text-gray-400 font-mono">{item.modality}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {needsUpc.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
            Need a UPC · {needsUpc.length}
          </p>
          <div className="divide-y divide-border">
            {needsUpc.map((item) => (
              <div key={item.productName} className="flex items-center gap-2.5 py-2.5 opacity-60">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium leading-snug truncate text-gray-700">
                    {item.productName}
                  </div>
                  <span className="text-[11px] text-gray-400 font-mono">×{item.quantity}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import { Badge } from "@/shared/ui/badge.js";
import { Card, CardContent } from "@/shared/ui/card.js";

import type { OrderHistoryContent } from "../../shared/types.js";

import { SectionHeader } from "../../shared/components.js";

export function OrderHistoryView({ data }: { data: OrderHistoryContent }) {
  const { orderId, items, totalItems, estimatedTotal, placedAt, locationId, notes } = data;

  const placedDate = new Date(placedAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="px-3.5 py-3 max-w-2xl mx-auto animate-view-in">
      <SectionHeader
        title="Order Placed"
        badge={<Badge variant="green">Recorded</Badge>}
        subtitle={placedDate}
      />

      <Card size="sm" className="mb-3">
        <CardContent className="pt-3 space-y-1">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span className="font-mono text-[10px]">{orderId}</span>
            {locationId && (
              <span className="text-[11px] text-gray-400 flex items-center gap-0.5">
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
                    d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"
                  />
                </svg>
                {locationId}
              </span>
            )}
          </div>

          <div className="flex items-baseline justify-between pt-1">
            <span className="text-[11px] text-gray-500">
              {totalItems} item{totalItems !== 1 ? "s" : ""}
            </span>
            {estimatedTotal != null && estimatedTotal > 0 && (
              <span className="text-base font-semibold text-emerald-600 font-mono">
                ${estimatedTotal.toFixed(2)}
              </span>
            )}
          </div>

          {notes && <p className="text-[11px] text-gray-400 italic pt-1">{notes}</p>}
        </CardContent>
      </Card>

      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
        Items · {items.length}
      </p>
      <div className="divide-y divide-border">
        {items.map((item, idx) => (
          <div key={`${item.productId}-${idx}`} className="flex items-center gap-2.5 py-2.5">
            <div className="shrink-0 w-6 h-6 rounded bg-gray-100 text-gray-400 flex items-center justify-center">
              <svg
                aria-hidden="true"
                className="w-3.5 h-3.5"
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
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-gray-900 truncate">
                {item.productName}
              </div>
              <div className="text-[11px] text-gray-400 font-mono">×{item.quantity}</div>
            </div>
            {item.price != null && (
              <span className="text-[13px] font-medium text-emerald-600 font-mono shrink-0">
                ${(item.price * item.quantity).toFixed(2)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

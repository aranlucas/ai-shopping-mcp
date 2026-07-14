import { Badge } from "@agents/ui/components/badge";
import { Card, CardContent } from "@agents/ui/components/card";

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
    <div className="mx-auto max-w-2xl animate-in px-3.5 py-3 fade-in slide-in-from-bottom-1">
      <SectionHeader
        title="Order Placed"
        badge={
          <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">
            Recorded
          </Badge>
        }
        subtitle={placedDate}
      />

      <Card size="sm" className="mb-3">
        <CardContent className="flex flex-col gap-1 pt-3">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span className="font-mono text-xs">{orderId}</span>
            {locationId && (
              <span className="flex items-center gap-0.5 text-xs text-gray-400">
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
            <span className="text-xs text-gray-500">
              {totalItems} item{totalItems !== 1 ? "s" : ""}
            </span>
            {estimatedTotal != null && estimatedTotal > 0 && (
              <span className="font-mono text-base font-semibold text-emerald-600">
                ${estimatedTotal.toFixed(2)}
              </span>
            )}
          </div>

          {notes && <p className="pt-1 text-xs text-gray-400 italic">{notes}</p>}
        </CardContent>
      </Card>

      <p className="mb-2 text-xs font-semibold tracking-wider text-gray-400 uppercase">
        Items · {items.length}
      </p>
      <div className="divide-y divide-border">
        {items.map((item, idx) => (
          <div key={`${item.upc}-${idx}`} className="flex items-center gap-2.5 py-2.5">
            <div className="flex size-6 shrink-0 items-center justify-center rounded bg-gray-100 text-gray-400">
              <svg
                aria-hidden="true"
                className="size-3.5"
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
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-gray-900">{item.productName}</div>
              <div className="font-mono text-xs text-gray-400">×{item.quantity}</div>
            </div>
            {item.price != null && (
              <span className="shrink-0 font-mono text-sm font-medium text-emerald-600">
                ${(item.price * item.quantity).toFixed(2)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

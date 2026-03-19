/** Reusable sub-components for client-side Views. */

import type { ProductData } from "./types.js";

const badgeVariants = {
  green:
    "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-400/20",
  red: "bg-red-50 text-red-700 ring-1 ring-red-600/20 dark:bg-red-950 dark:text-red-300 dark:ring-red-400/20",
  yellow:
    "bg-amber-50 text-amber-700 ring-1 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-400/20",
  blue: "bg-blue-50 text-blue-700 ring-1 ring-blue-600/20 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-400/20",
  gray: "bg-gray-100 text-gray-600 ring-1 ring-gray-500/20 dark:bg-gray-700 dark:text-gray-300 dark:ring-gray-400/20",
} as const;

export function Badge({
  variant,
  children,
}: {
  variant: "green" | "red" | "yellow" | "blue" | "gray";
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeVariants[variant]}`}
    >
      {children}
    </span>
  );
}

export function FulfillmentTags({ product }: { product: ProductData }) {
  const item = product.items?.[0];
  if (!item?.fulfillment) return null;

  const tags: Array<{ label: string; cls: string }> = [];
  if (item.fulfillment.curbside)
    tags.push({
      label: "Pickup",
      cls: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    });
  if (item.fulfillment.delivery)
    tags.push({
      label: "Delivery",
      cls: "bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300",
    });
  if (item.fulfillment.instore)
    tags.push({
      label: "In-Store",
      cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
    });

  if (tags.length === 0) {
    return (
      <div className="flex flex-wrap gap-1.5 mt-2">
        <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300">
          Out of Stock
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {tags.map((t) => (
        <span
          key={t.label}
          className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold ${t.cls}`}
        >
          {t.label}
        </span>
      ))}
    </div>
  );
}

export function PriceDisplay({ product }: { product: ProductData }) {
  const item = product.items?.[0];
  if (!item?.price?.regular) {
    return (
      <span className="text-xs text-gray-400 dark:text-gray-500">
        Price unavailable
      </span>
    );
  }
  const { regular, promo } = item.price;
  const hasPromo = promo != null && promo !== regular;

  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
        ${hasPromo ? promo : regular}
      </span>
      {hasPromo && (
        <span className="text-sm text-gray-400 dark:text-gray-500 line-through">
          ${regular}
        </span>
      )}
      {hasPromo && (
        <span className="inline-flex items-center rounded-md bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
          SALE
        </span>
      )}
    </span>
  );
}

export function ProductActions({
  upc,
  name,
  onAddToCart,
  onAddToList,
}: {
  upc: string | undefined;
  name: string;
  onAddToCart: (upc: string, qty: number) => void;
  onAddToList: (name: string, upc: string) => void;
}) {
  if (!upc) return null;
  return (
    <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 active:bg-blue-800 transition-colors"
        onClick={() => onAddToCart(upc, 1)}
      >
        <svg
          aria-hidden="true"
          className="w-3.5 h-3.5"
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
        Add to Cart
      </button>
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-lg bg-gray-50 px-3.5 py-2 text-xs font-semibold text-gray-700 ring-1 ring-gray-200 hover:bg-gray-100 active:bg-gray-200 transition-colors dark:bg-gray-700 dark:text-gray-200 dark:ring-gray-600 dark:hover:bg-gray-600"
        onClick={() => onAddToList(name, upc)}
      >
        <svg
          aria-hidden="true"
          className="w-3.5 h-3.5"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 4.5v15m7.5-7.5h-15"
          />
        </svg>
        List
      </button>
    </div>
  );
}

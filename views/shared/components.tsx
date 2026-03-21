/** Reusable sub-components for client-side Views. */

import React from "react";
import type { ProductData } from "./types.js";

const badgeVariants = {
  green:
    "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-400/20",
  red: "bg-red-50 text-red-700 ring-1 ring-red-600/20 dark:bg-red-950 dark:text-red-300 dark:ring-red-400/20",
  yellow:
    "bg-amber-50 text-amber-700 ring-1 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-400/20",
  blue: "bg-blue-50 text-blue-700 ring-1 ring-blue-600/20 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-400/20",
  gray: "bg-gray-100 text-gray-600 ring-1 ring-gray-500/20 dark:bg-gray-700 dark:text-gray-300 dark:ring-gray-400/20",
  purple:
    "bg-purple-50 text-purple-700 ring-1 ring-purple-600/20 dark:bg-purple-950 dark:text-purple-300 dark:ring-purple-400/20",
} as const;

export function Badge({
  variant,
  children,
}: {
  variant: "green" | "red" | "yellow" | "blue" | "gray" | "purple";
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeVariants[variant]}`}
    >
      {children}
    </span>
  );
}

export function SectionHeader({
  title,
  badge,
  subtitle,
}: {
  title: string;
  badge?: React.ReactNode;
  subtitle?: string;
}) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2.5">
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 tracking-tight">
          {title}
        </h1>
        {badge}
      </div>
      {subtitle && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {subtitle}
        </p>
      )}
    </div>
  );
}

export function FulfillmentTags({ product }: { product: ProductData }) {
  const item = product.items?.[0];
  if (!item?.fulfillment) return null;

  const tags: Array<{ label: string; cls: string }> = [];
  if (item.fulfillment.curbside)
    tags.push({
      label: "Pickup",
      cls: "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300",
    });
  if (item.fulfillment.delivery)
    tags.push({
      label: "Delivery",
      cls: "bg-pink-50 text-pink-700 dark:bg-pink-950/60 dark:text-pink-300",
    });
  if (item.fulfillment.instore)
    tags.push({
      label: "In-Store",
      cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
    });

  if (tags.length === 0) {
    return (
      <div className="flex flex-wrap gap-1 mt-2">
        <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-400 ring-1 ring-red-600/10">
          Out of Stock
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {tags.map((t) => (
        <span
          key={t.label}
          className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold ${t.cls} ring-1 ring-current/10`}
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
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-base font-bold text-emerald-600 dark:text-emerald-400">
        ${hasPromo ? promo?.toFixed(2) : regular?.toFixed(2)}
      </span>
      {hasPromo && (
        <>
          <span className="text-xs text-gray-400 dark:text-gray-500 line-through">
            ${regular?.toFixed(2)}
          </span>
          <span className="inline-flex items-center rounded bg-red-500 px-1 py-px text-[10px] font-bold text-white leading-tight">
            SALE
          </span>
        </>
      )}
    </span>
  );
}

export function ActionButton({
  state,
  onClick,
  disabled,
  icon,
  idleLabel,
  loadingLabel,
  doneLabel,
  failLabel,
  variant = "primary",
}: {
  state: "idle" | "loading" | "done" | "error";
  onClick: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  idleLabel: string;
  loadingLabel?: string;
  doneLabel?: string;
  failLabel?: string;
  variant?: "primary" | "secondary";
}) {
  const label =
    state === "loading"
      ? (loadingLabel ?? "Loading...")
      : state === "done"
        ? (doneLabel ?? "Done!")
        : state === "error"
          ? (failLabel ?? "Failed")
          : idleLabel;

  const primaryCls =
    state === "done"
      ? "bg-emerald-600 text-white shadow-sm"
      : state === "error"
        ? "bg-red-600 text-white shadow-sm"
        : "bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-sm";

  const secondaryCls =
    state === "done"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-800"
      : state === "error"
        ? "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/50 dark:text-red-300 dark:ring-red-800"
        : "bg-gray-50 text-gray-700 ring-gray-200 hover:bg-gray-100 active:bg-gray-200 dark:bg-gray-700/50 dark:text-gray-200 dark:ring-gray-600 dark:hover:bg-gray-700";

  return (
    <button
      type="button"
      disabled={disabled || state === "loading"}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-150 ${
        variant === "primary" ? primaryCls : `ring-1 ${secondaryCls}`
      } disabled:opacity-50 disabled:cursor-not-allowed`}
      onClick={onClick}
    >
      {icon && state === "idle" && (
        <span className="shrink-0 w-3.5 h-3.5">{icon}</span>
      )}
      {state === "loading" && (
        <svg
          aria-hidden="true"
          className="animate-spin shrink-0 w-3.5 h-3.5"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {label}
    </button>
  );
}

export function ProductActions({
  upc,
  name,
  disabled,
  onAddToCart,
  onAddToList,
}: {
  upc: string | undefined;
  name: string;
  disabled?: boolean;
  onAddToCart: (upc: string, qty: number) => Promise<void>;
  onAddToList: (name: string, upc: string) => Promise<void>;
}) {
  const [cartState, setCartState] = React.useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [listState, setListState] = React.useState<
    "idle" | "loading" | "done" | "error"
  >("idle");

  if (!upc) return null;

  const handleCart = async () => {
    setCartState("loading");
    try {
      await onAddToCart(upc, 1);
      setCartState("done");
      setTimeout(() => setCartState("idle"), 2000);
    } catch {
      setCartState("error");
      setTimeout(() => setCartState("idle"), 2000);
    }
  };

  const handleList = async () => {
    setListState("loading");
    try {
      await onAddToList(name, upc);
      setListState("done");
      setTimeout(() => setListState("idle"), 2000);
    } catch {
      setListState("error");
      setTimeout(() => setListState("idle"), 2000);
    }
  };

  return (
    <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/50">
      <ActionButton
        state={cartState}
        onClick={handleCart}
        disabled={disabled}
        idleLabel="Add to Cart"
        loadingLabel="Adding..."
        doneLabel="Added!"
        failLabel="Failed"
        variant="primary"
        icon={
          <svg
            aria-hidden="true"
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
        }
      />
      <ActionButton
        state={listState}
        onClick={handleList}
        disabled={disabled}
        idleLabel="Save"
        loadingLabel="Saving..."
        doneLabel="Saved!"
        failLabel="Failed"
        variant="secondary"
        icon={
          <svg
            aria-hidden="true"
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
        }
      />
    </div>
  );
}

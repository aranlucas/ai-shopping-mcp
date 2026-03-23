import { ReactNode, useState } from "react";
import type { ProductData } from "./types.js";

const badgeVariants = {
  green: "bg-emerald-50 text-emerald-700",
  red: "bg-red-50 text-red-600",
  yellow: "bg-amber-50 text-amber-700",
  blue: "bg-blue-50 text-blue-700",
  gray: "bg-gray-100 text-gray-500",
  purple: "bg-purple-50 text-purple-700",
} as const;

export function Badge({
  variant,
  children,
}: {
  variant: "green" | "red" | "yellow" | "blue" | "gray" | "purple";
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${badgeVariants[variant]}`}
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
  badge?: ReactNode;
  subtitle?: string;
}) {
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-sm font-semibold text-gray-900 tracking-tight">{title}</h1>
        {badge}
      </div>
      {subtitle && <p className="text-[11px] text-gray-400 mt-0.5">{subtitle}</p>}
    </div>
  );
}

export function FulfillmentTags({ product }: { product: ProductData }) {
  const item = product.items?.[0];
  if (!item?.fulfillment) return null;

  const tags: Array<{ label: string; variant: "blue" | "purple" | "green" }> = [];
  if (item.fulfillment.curbside) tags.push({ label: "Pickup", variant: "blue" });
  if (item.fulfillment.delivery) tags.push({ label: "Delivery", variant: "purple" });
  if (item.fulfillment.instore) tags.push({ label: "In-Store", variant: "green" });

  if (tags.length === 0) {
    return (
      <div className="flex flex-wrap gap-1 mt-1.5">
        <Badge variant="red">Out of Stock</Badge>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {tags.map((t) => (
        <Badge key={t.label} variant={t.variant}>
          {t.label}
        </Badge>
      ))}
    </div>
  );
}

export function PriceDisplay({ product }: { product: ProductData }) {
  const item = product.items?.[0];
  if (!item?.price?.regular) {
    return <span className="text-xs text-gray-400 font-mono">—</span>;
  }
  const { regular, promo } = item.price;
  const hasPromo = promo != null && promo !== regular;

  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[15px] font-medium text-emerald-600 font-mono leading-none">
        ${hasPromo ? promo?.toFixed(2) : regular?.toFixed(2)}
      </span>
      {hasPromo && (
        <>
          <span className="text-xs text-gray-400 line-through font-mono">
            ${regular?.toFixed(2)}
          </span>
          <Badge variant="red">Sale</Badge>
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
  icon?: ReactNode;
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
      ? "bg-emerald-600 text-white"
      : state === "error"
        ? "bg-red-500 text-white"
        : "bg-[var(--app-accent)] hover:bg-[var(--app-accent-hover)] active:bg-[var(--app-accent-active)] text-white";

  const secondaryCls =
    state === "done"
      ? "border-emerald-300 text-emerald-700 bg-emerald-50"
      : state === "error"
        ? "border-red-200 text-red-600 bg-red-50"
        : "border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 active:bg-gray-100";

  return (
    <button
      type="button"
      disabled={disabled || state === "loading"}
      className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-all duration-150 ${
        variant === "primary" ? primaryCls : `border ${secondaryCls}`
      } disabled:opacity-40 disabled:cursor-not-allowed`}
      onClick={onClick}
    >
      {icon && state === "idle" && <span className="shrink-0 w-3 h-3">{icon}</span>}
      {state === "loading" && (
        <svg
          aria-hidden="true"
          className="animate-spin shrink-0 w-3 h-3"
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
  const [cartState, setCartState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [listState, setListState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!upc) return null;

  const handleCart = async () => {
    setCartState("loading");
    setErrorMsg(null);
    try {
      await onAddToCart(upc, 1);
      setCartState("done");
      setTimeout(() => setCartState("idle"), 2000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to add to cart";
      setCartState("error");
      setErrorMsg(msg);
      setTimeout(() => {
        setCartState("idle");
        setErrorMsg(null);
      }, 5000);
    }
  };

  const handleList = async () => {
    setListState("loading");
    setErrorMsg(null);
    try {
      await onAddToList(name, upc);
      setListState("done");
      setTimeout(() => setListState("idle"), 2000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to add to list";
      setListState("error");
      setErrorMsg(msg);
      setTimeout(() => {
        setListState("idle");
        setErrorMsg(null);
      }, 5000);
    }
  };

  return (
    <div className="mt-2.5 pt-2.5 border-t border-[var(--app-border)]">
      <div className="flex gap-1.5">
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
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          }
        />
      </div>
      {errorMsg && <div className="mt-1 text-[11px] text-red-600">{errorMsg}</div>}
    </div>
  );
}

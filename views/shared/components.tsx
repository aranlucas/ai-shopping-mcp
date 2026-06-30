import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps/react";

import { ReactNode, useState } from "react";

import { Badge } from "@/shared/ui/badge.js";
import { Button } from "@/shared/ui/button.js";
import { Card, CardContent, CardFooter } from "@/shared/ui/card.js";

import type { ProductData } from "./types.js";

export { Badge };

export function SectionHeader({
  title,
  badge,
  subtitle,
  trailing,
}: {
  title: string;
  badge?: ReactNode;
  subtitle?: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-sm font-semibold text-gray-900 tracking-tight truncate">{title}</h1>
          {badge}
        </div>
        {trailing}
      </div>
      {subtitle && <p className="text-[11px] text-gray-400 mt-0.5">{subtitle}</p>}
    </div>
  );
}

export function DisplayModeToggle({
  app,
  hostContext,
}: {
  app: App | null | undefined;
  hostContext: McpUiHostContext | undefined;
}) {
  const current = hostContext?.displayMode;
  const available = hostContext?.availableDisplayModes ?? [];
  const supportsFullscreen = available.includes("fullscreen");
  const supportsInline = available.includes("inline");
  if (!app || !supportsFullscreen || !supportsInline) return null;
  const isFullscreen = current === "fullscreen";
  const next = isFullscreen ? "inline" : "fullscreen";

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={() => {
        void app.requestDisplayMode({ mode: next });
      }}
      aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
    >
      <svg
        aria-hidden="true"
        className="w-3.5 h-3.5"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2}
        stroke="currentColor"
      >
        {isFullscreen ? (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25"
          />
        ) : (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
          />
        )}
      </svg>
    </Button>
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

  const shadcnVariant =
    state === "done"
      ? ("secondary" as const)
      : state === "error"
        ? ("destructive" as const)
        : variant === "primary"
          ? ("default" as const)
          : ("outline" as const);

  return (
    <Button
      variant={shadcnVariant}
      size="xs"
      disabled={disabled || state === "loading"}
      onClick={onClick}
      className={
        state === "done" && variant === "primary"
          ? "bg-emerald-600 text-white hover:bg-emerald-700"
          : state === "done" && variant === "secondary"
            ? "border-emerald-300 text-emerald-700 bg-emerald-50"
            : variant === "primary" && state === "idle"
              ? "bg-[var(--app-accent)] hover:bg-[var(--app-accent-hover)] text-white border-transparent"
              : undefined
      }
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
    </Button>
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
  onAddToCart: (name: string, upc: string, qty: number) => Promise<void>;
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
      await onAddToCart(name, upc, 1);
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
    <div>
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

function ProductImage({ product }: { product: ProductData }) {
  const frontImage = product.images?.find(
    (img) => (img as { default?: boolean }).default || img.perspective === "front",
  );
  const sizes = frontImage?.sizes ?? product.images?.[0]?.sizes;
  const thumbnail =
    sizes?.find((s) => s.size === "thumbnail" || s.size === "small")?.url ?? sizes?.[0]?.url;

  if (!thumbnail) {
    const initials = (product.description ?? "?")
      .split(" ")
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
    return (
      <div className="w-full aspect-square bg-gray-50 flex items-center justify-center">
        <span className="text-xl font-bold text-gray-300">{initials}</span>
      </div>
    );
  }

  return (
    <div className="w-full aspect-square bg-gray-50 overflow-hidden">
      <img
        src={thumbnail}
        alt={product.description ?? "Product"}
        className="w-full h-full object-contain p-2"
        loading="lazy"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
    </div>
  );
}

export function ProductCard({
  product,
  canCallTools,
  onAddToCart,
  onAddToList,
}: {
  product: ProductData;
  canCallTools: boolean;
  onAddToCart: (name: string, upc: string, qty: number) => Promise<void>;
  onAddToList: (name: string, upc: string) => Promise<void>;
}) {
  const name = product.description || "Unknown Product";
  const brand = product.brand;
  const upc = product.upc;
  const size = product.items?.[0]?.size;
  const aisle =
    product.aisleLocations?.[0]?.description ||
    (product.aisleLocations?.[0]?.number ? `Aisle ${product.aisleLocations[0].number}` : undefined);

  return (
    <Card size="sm" className="h-full hover:shadow-md transition-shadow duration-150">
      <ProductImage product={product} />
      <CardContent className="flex flex-col flex-1 pt-2">
        <div className="flex-1">
          <div className="font-medium text-[13px] text-gray-900 leading-snug line-clamp-2">
            {name}
          </div>
          {(brand || size) && (
            <div className="text-[11px] text-gray-400 mt-0.5">
              {brand}
              {brand && size && " · "}
              {size}
            </div>
          )}
          {aisle && (
            <div className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-0.5">
              <svg
                aria-hidden="true"
                className="w-2.5 h-2.5 shrink-0"
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
              {aisle}
            </div>
          )}
        </div>
        <div className="mt-1.5">
          <PriceDisplay product={product} />
        </div>
        <FulfillmentTags product={product} />
      </CardContent>
      {upc && (
        <CardFooter className="pt-2">
          <ProductActions
            upc={upc}
            name={name}
            disabled={!canCallTools}
            onAddToCart={onAddToCart}
            onAddToList={onAddToList}
          />
        </CardFooter>
      )}
    </Card>
  );
}

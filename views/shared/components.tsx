import type { CartState } from "../app/cart-action.js";
import { useCartAction } from "../app/use-cart-action.js";
import type {
  App,
  McpUiHostContext,
} from "@modelcontextprotocol/ext-apps/react";

import { useCallback, useId, useMemo, useState } from "react";
import type { ChangeEvent, MouseEvent, ReactNode } from "react";

import { loadShoppingLists } from "../app/tool-calls.js";

import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardFooter } from "./ui/card";

import type { ProductData, ShoppingListSummaryData } from "./types.js";

export { Badge };

const CART_ICON = (
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
);

const PLUS_ICON = (
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
);

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
    <div className="mb-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold tracking-tight wrap-break-word text-gray-900">
            {title}
          </h1>
          {badge}
        </div>
        {trailing}
      </div>
      {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
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
  const isFullscreen = current === "fullscreen";
  const next = isFullscreen ? "inline" : "fullscreen";
  const handleToggleDisplayMode = useCallback(() => {
    app?.requestDisplayMode({ mode: next }).catch(console.error);
  }, [app, next]);
  if (!app || !supportsFullscreen || !supportsInline) return null;

  return (
    <Button
      variant="ghost"
      size="icon-lg"
      onClick={handleToggleDisplayMode}
      aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
    >
      <svg
        aria-hidden="true"
        className="size-3.5"
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
  const tags: Array<{ label: string; tone: "info" | "danger" }> = product.pickup
    ? [{ label: "Pickup", tone: "info" }]
    : [];
  if (!product.available) tags.push({ label: "Out of Stock", tone: "danger" });
  if (tags.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {tags.map((t) => (
        <Badge key={t.label} variant="outline" tone={t.tone}>
          {t.label}
        </Badge>
      ))}
    </div>
  );
}

export function PriceDisplay({ product }: { product: ProductData }) {
  if (product.price === undefined) {
    return <span className="text-xs text-gray-500">Price unavailable</span>;
  }
  const hasPromo =
    product.regularPrice !== undefined && product.regularPrice > product.price;

  return (
    <span className="inline-flex flex-wrap items-baseline gap-2">
      <span className="text-lg leading-none font-semibold text-emerald-600 tabular-nums">
        ${product.price.toFixed(2)}
      </span>
      {hasPromo && (
        <>
          <span className="text-xs text-gray-500 tabular-nums line-through">
            ${product.regularPrice?.toFixed(2)}
          </span>
          <Badge variant="outline" tone="danger">
            Sale
          </Badge>
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
  labelContext,
  iconOnly = false,
}: {
  state: "idle" | "loading" | "done" | "error";
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  icon?: ReactNode;
  idleLabel: string;
  loadingLabel?: string;
  doneLabel?: string;
  failLabel?: string;
  variant?: "primary" | "secondary";
  labelContext?: string;
  /** Show only the icon; the state label stays available to screen readers. */
  iconOnly?: boolean;
}) {
  const handleClick = useCallback(() => {
    // Callers own their visible loading/error state. This event boundary also
    // catches unexpected throws and rejected promises before returning to React.
    Promise.resolve().then(onClick).catch(console.error);
  }, [onClick]);
  const label = {
    idle: idleLabel,
    loading: loadingLabel ?? "Loading...",
    done: doneLabel ?? "Done!",
    error: failLabel ?? "Failed",
  }[state];
  const baseVariant = { primary: "default", secondary: "outline" } as const;
  const successVariant = {
    primary: "success",
    secondary: "success-outline",
  } as const;
  const shadcnVariant = {
    idle: baseVariant[variant],
    loading: baseVariant[variant],
    done: successVariant[variant],
    error: "destructive",
  } as const;

  return (
    <Button
      variant={shadcnVariant[state]}
      size="default"
      disabled={disabled || state === "loading"}
      aria-busy={state === "loading"}
      aria-label={labelContext ? `${label}: ${labelContext}` : undefined}
      onClick={handleClick}
    >
      {icon && state === "idle" && (
        <span className="size-3 shrink-0">{icon}</span>
      )}
      {state === "loading" && (
        <svg
          aria-hidden="true"
          className="size-3 shrink-0 animate-spin"
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
      <span aria-live="polite" className={iconOnly ? "sr-only" : undefined}>
        {label}
      </span>
    </Button>
  );
}

/** A link that opens through the host when it can, else as a normal link. */
export function ExternalLink({
  app,
  href,
  children,
}: {
  app: App | null;
  href: string;
  children: ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (!app?.getHostCapabilities?.()?.openLinks) return;
      event.preventDefault();
      setError(null);
      app
        .openLink({ url: href })
        .then((result) => {
          if (result.isError)
            setError("Could not open Kroger. Open it in your browser instead.");
          return result;
        })
        .catch(() =>
          setError("Could not open Kroger. Open it in your browser instead."),
        );
    },
    [app, href],
  );
  return (
    <>
      <a
        href={href}
        onClick={handleClick}
        target="_blank"
        rel="noreferrer"
        className="text-sm font-medium underline"
      >
        {children}
      </a>
      {error && <span role="alert">{error}</span>}
    </>
  );
}

export function CartCheckLink({
  app,
  label = "Check Kroger cart",
}: {
  app: App | null;
  label?: string;
}) {
  return (
    <ExternalLink app={app} href="https://www.kroger.com/cart">
      {label}
    </ExternalLink>
  );
}

const CART_BUTTON_STATE = {
  idle: "idle",
  submitting: "loading",
  added: "done",
  already_added: "done",
  retryable: "error",
} as const;

/** Render recovery and button state from the same cart outcome. */
export function CartActionControl({
  app,
  state,
  onSubmit,
  ...labels
}: {
  app: App | null;
  state: CartState;
  onSubmit: () => Promise<void>;
  disabled?: boolean;
  idleLabel: string;
  loadingLabel: string;
  doneLabel: string;
  failLabel: string;
  labelContext?: string;
}) {
  if (state.status === "needs_match") {
    return (
      <div>
        <p role="alert" className="mt-2 text-sm text-amber-700">
          {state.message}
        </p>
      </div>
    );
  }

  if (state.status === "check_list") {
    return (
      <div>
        <p role="alert" className="mt-2 text-sm text-red-600">
          {state.message}
        </p>
      </div>
    );
  }

  return (
    <div>
      {state.status === "check_cart" ? (
        <CartCheckLink app={app} />
      ) : (
        <ActionButton
          {...labels}
          state={CART_BUTTON_STATE[state.status]}
          doneLabel={
            state.status === "already_added"
              ? "Already added"
              : labels.doneLabel
          }
          onClick={onSubmit}
          disabled={
            labels.disabled ||
            state.status === "added" ||
            state.status === "already_added"
          }
          icon={CART_ICON}
        />
      )}
      {"message" in state && (
        <p
          role="alert"
          className={`mt-2 text-sm ${
            state.status === "already_added"
              ? "text-emerald-700"
              : "text-red-600"
          }`}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}

/** A product to save to a shopping list. */
export type SaveableProduct = {
  productName: string;
  upc: string;
  quantity: number;
  price?: number;
};

export type SaveProductToList = (
  product: SaveableProduct,
  listId?: string,
) => Promise<void>;

const NEW_LIST = "";

/**
 * "Save to list" that asks which list to use. Lists load on first open; if
 * they cannot load, the product can still go to a new list.
 */
function SaveToListControl({
  app,
  product,
  disabled,
  onSave,
}: {
  app: App | null;
  product: SaveableProduct;
  disabled?: boolean;
  onSave: SaveProductToList;
}) {
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState<ShoppingListSummaryData[] | null>(null);
  const [listsState, setListsState] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [target, setTarget] = useState(NEW_LIST);
  const [saveState, setSaveState] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const selectId = useId();

  const handleOpen = useCallback(async () => {
    setOpen(true);
    setError(null);
    if (lists !== null) return;
    setListsState("loading");
    try {
      setLists(await loadShoppingLists(app));
      setListsState("idle");
    } catch {
      setLists([]);
      setListsState("error");
    }
  }, [app, lists]);

  const handleClose = useCallback(() => {
    setOpen(false);
    setSaveState("idle");
  }, []);

  const handleTarget = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => setTarget(event.target.value),
    [],
  );

  const handleSave = useCallback(async () => {
    setSaveState("loading");
    setError(null);
    try {
      await onSave(product, target || undefined);
      setSaveState("done");
      // A new list now exists; reload next time the picker opens.
      if (!target) setLists(null);
      setTimeout(() => {
        setOpen(false);
        setSaveState("idle");
      }, 1500);
    } catch (e) {
      setSaveState("error");
      setError(e instanceof Error ? e.message : "Failed to save to list");
    }
  }, [onSave, product, target]);

  if (!open) {
    return (
      <ActionButton
        state="idle"
        onClick={handleOpen}
        disabled={disabled}
        idleLabel="Save to list"
        labelContext={product.productName}
        variant="secondary"
        icon={PLUS_ICON}
      />
    );
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <label htmlFor={selectId} className="text-xs text-gray-600">
        Save {product.productName} to
      </label>
      <select
        id={selectId}
        value={target}
        onChange={handleTarget}
        disabled={listsState === "loading" || saveState === "loading"}
        className="rounded-md border border-border bg-background p-1.5 text-sm"
      >
        <option value={NEW_LIST}>New list</option>
        {(lists ?? []).map((list) => (
          <option key={list.id} value={list.id}>
            {list.name} ({list.itemCount})
          </option>
        ))}
      </select>
      {listsState === "loading" && (
        <output className="text-xs text-gray-500">Loading your lists…</output>
      )}
      {listsState === "error" && (
        <p className="text-xs text-gray-500">
          Couldn&apos;t load your lists. You can still save to a new list.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <ActionButton
          state={saveState}
          onClick={handleSave}
          disabled={disabled || listsState === "loading"}
          idleLabel="Save"
          loadingLabel="Saving..."
          doneLabel="Saved!"
          failLabel="Retry save"
          labelContext={product.productName}
          variant="secondary"
        />
        <Button variant="ghost" size="sm" onClick={handleClose}>
          Cancel
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function ProductActions({
  app,
  upc,
  name,
  price,
  disabled,
  cartDisabled,
  onAddToList,
}: {
  app: App | null;
  upc: string;
  name: string;
  price?: number;
  disabled?: boolean;
  cartDisabled?: boolean;
  onAddToList: SaveProductToList;
}) {
  const cart = useCartAction(
    app,
    {
      kind: "product",
      product: {
        listName: `Cart: ${name}`,
        productName: name,
        upc,
        quantity: 1,
        price,
      },
      modality: "PICKUP",
    },
    2000,
  );
  const saveable = useMemo(
    () => ({ productName: name, upc, quantity: 1, price }),
    [name, upc, price],
  );

  return (
    <div className="flex flex-wrap gap-2">
      <CartActionControl
        app={app}
        state={cart.state}
        onSubmit={cart.submit}
        disabled={disabled || cartDisabled}
        idleLabel="Add to Cart"
        loadingLabel="Adding..."
        doneLabel="Added!"
        failLabel="Retry cart"
        labelContext={name}
      />
      <SaveToListControl
        app={app}
        product={saveable}
        disabled={disabled}
        onSave={onAddToList}
      />
    </div>
  );
}

function ProductImage({ product }: { product: ProductData }) {
  const thumbnail = product.imageUrl;
  const [failedUrl, setFailedUrl] = useState<string | undefined>();
  const handleImageError = useCallback(
    () => setFailedUrl(thumbnail),
    [thumbnail],
  );

  if (!thumbnail || failedUrl === thumbnail) {
    const initials = product.name
      .split(" ")
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
    return (
      <div className="flex aspect-4/3 w-full flex-col items-center justify-center gap-1 bg-muted">
        <span
          aria-hidden="true"
          className="text-2xl font-semibold text-gray-500"
        >
          {initials}
        </span>
        <span className="text-xs text-gray-500">No image</span>
      </div>
    );
  }

  return (
    <div className="aspect-4/3 w-full overflow-hidden bg-white">
      <img
        src={thumbnail}
        alt={product.name}
        className="size-full object-contain p-2"
        loading="lazy"
        onError={handleImageError}
      />
    </div>
  );
}

export function ProductCard({
  app,
  product,
  canCallTools,
  onAddToList,
}: {
  app: App | null;
  product: ProductData;
  canCallTools: boolean;
  onAddToList: SaveProductToList;
}) {
  const name = product.name;
  const brand = product.brand;
  const upc = product.upc;
  const size = product.size;
  const aisle =
    product.aisle?.description ||
    (product.aisle?.number ? `Aisle ${product.aisle.number}` : undefined);

  return (
    <Card size="sm" className="h-full gap-3 pt-0">
      <ProductImage product={product} />
      <CardContent className="flex flex-1 flex-col pt-2">
        <div className="flex-1">
          <h3 className="text-sm leading-snug font-semibold text-gray-900">
            {name}
          </h3>
          {(brand || size) && (
            <div className="mt-0.5 text-xs text-gray-400">
              {brand}
              {brand && size && " · "}
              {size}
            </div>
          )}
          {aisle && (
            <div className="mt-0.5 flex items-center gap-0.5 text-xs text-gray-400">
              <svg
                aria-hidden="true"
                className="size-2.5 shrink-0"
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
        <div className="min-h-7">
          <FulfillmentTags product={product} />
        </div>
      </CardContent>
      <CardFooter className="pt-2">
        <ProductActions
          app={app}
          upc={upc}
          cartDisabled={!product.available}
          name={name}
          price={product.price}
          disabled={!canCallTools}
          onAddToList={onAddToList}
        />
      </CardFooter>
    </Card>
  );
}

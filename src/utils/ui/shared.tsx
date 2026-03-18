/** Reusable sub-components used across multiple UI templates. */

import type { components as ProductComponents } from "../../services/kroger/product.js";

type Product = ProductComponents["schemas"]["products.productModel"];

export function Badge({
  variant,
  children,
}: {
  variant: "green" | "red" | "yellow" | "blue" | "gray";
  children: React.ReactNode;
}) {
  return <span className={`badge badge-${variant}`}>{children}</span>;
}

export function FulfillmentTags({ product }: { product: Product }) {
  const item = product.items?.[0];
  if (!item?.fulfillment) return null;

  const tags: Array<{ label: string; cls: string }> = [];
  if (item.fulfillment.curbside)
    tags.push({ label: "Pickup", cls: "tag-pickup" });
  if (item.fulfillment.delivery)
    tags.push({ label: "Delivery", cls: "tag-delivery" });
  if (item.fulfillment.instore)
    tags.push({ label: "In-Store", cls: "tag-instore" });

  if (tags.length === 0) {
    return (
      <div className="fulfillment-tags">
        <span className="tag tag-oos">Out of Stock</span>
      </div>
    );
  }

  return (
    <div className="fulfillment-tags">
      {tags.map((t) => (
        <span key={t.label} className={`tag ${t.cls}`}>
          {t.label}
        </span>
      ))}
    </div>
  );
}

export function PriceDisplay({ product }: { product: Product }) {
  const item = product.items?.[0];
  if (!item?.price?.regular) {
    return <span className="meta-item">Price unavailable</span>;
  }
  const { regular, promo } = item.price;
  const hasPromo = promo != null && promo !== regular;

  return (
    <span>
      <span className="price">${hasPromo ? promo : regular}</span>
      {hasPromo && <span className="price-original">${regular}</span>}
      {hasPromo && <span className="sale-badge">SALE</span>}
    </span>
  );
}

export function ProductActions({
  upc,
  name,
}: {
  upc: string | undefined;
  name: string;
}) {
  if (!upc) return null;
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
      <button
        type="button"
        className="btn btn-primary"
        onClick={`addToCart('${esc(upc)}', 1)` as never}
      >
        Add to Cart
      </button>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={`addToShoppingList('${esc(name)}', '${esc(upc)}')` as never}
      >
        + List
      </button>
    </div>
  );
}

/** Escape for safe embedding inside JS string literals (single-quoted). */
export function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

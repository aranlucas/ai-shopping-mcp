/** Reusable sub-components for client-side Views. */

import type { ProductData } from "./types.js";

export function Badge({
  variant,
  children,
}: {
  variant: "green" | "red" | "yellow" | "blue" | "gray";
  children: React.ReactNode;
}) {
  return <span className={`badge badge-${variant}`}>{children}</span>;
}

export function FulfillmentTags({ product }: { product: ProductData }) {
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

export function PriceDisplay({ product }: { product: ProductData }) {
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
    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => onAddToCart(upc, 1)}
      >
        Add to Cart
      </button>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => onAddToList(name, upc)}
      >
        + List
      </button>
    </div>
  );
}

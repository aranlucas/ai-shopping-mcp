import type { components as ProductComponents } from "../../services/kroger/product.js";
import { Badge, esc, FulfillmentTags, PriceDisplay } from "./shared.js";

type Product = ProductComponents["schemas"]["products.productModel"];
type ProductItem = ProductComponents["schemas"]["products.productItemModel"];

function StockBadge({ level }: { level: string | undefined }) {
  if (!level) return null;
  if (level === "LOW") return <Badge variant="yellow">Low Stock</Badge>;
  if (level === "TEMPORARILY_OUT_OF_STOCK")
    return <Badge variant="red">Out of Stock</Badge>;
  return <Badge variant="green">In Stock</Badge>;
}

export function ProductDetail({ product }: { product: Product }) {
  const name = product.description || "Unknown Product";
  const brand = product.brand;
  const upc = product.upc;

  return (
    <div
      className="card"
      style={{ border: "none", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
    >
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{name}</div>
        {brand && (
          <div style={{ fontSize: 14, color: "#6b7280", marginTop: 2 }}>
            {brand}
          </div>
        )}
      </div>

      <div>
        <PriceDisplay product={product} />
      </div>

      <FulfillmentTags product={product} />

      {upc && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
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
            onClick={
              `addToShoppingList('${esc(name)}', '${esc(upc)}')` as never
            }
          >
            + Shopping List
          </button>
        </div>
      )}

      {product.items && product.items.length > 0 && (
        <div className="detail-section">
          <div className="detail-label">Options</div>
          {product.items.map((item: ProductItem) => (
            <div key={item.size ?? item.itemId} className="meta-row">
              {item.size && <span>{item.size}</span>}
              {item.price?.regular && (
                <span>&middot; ${item.price.regular}</span>
              )}
              <StockBadge level={item.inventory?.stockLevel} />
            </div>
          ))}
        </div>
      )}

      {product.categories && product.categories.length > 0 && (
        <div className="detail-section">
          <div className="detail-label">Category</div>
          <div className="meta-row">
            {product.categories.map((c) => (
              <Badge key={c} variant="gray">
                {c}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {product.aisleLocations && product.aisleLocations.length > 0 && (
        <div className="detail-section">
          <div className="detail-label">Aisle Location</div>
          {product.aisleLocations.map((loc) => (
            <div key={loc.description ?? loc.number} className="meta-item">
              {loc.description} {loc.number ? `(${loc.number})` : ""}
            </div>
          ))}
        </div>
      )}

      {upc && (
        <div className="detail-section">
          <div className="detail-label">UPC</div>
          <div className="meta-item">{upc}</div>
        </div>
      )}
    </div>
  );
}

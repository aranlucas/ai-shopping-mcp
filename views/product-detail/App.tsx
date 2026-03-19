import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge, FulfillmentTags, PriceDisplay } from "../shared/components.js";
import type { ProductDetailContent } from "../shared/types.js";

function StockBadge({ level }: { level: string | undefined }) {
  if (!level) return null;
  if (level === "LOW") return <Badge variant="yellow">Low Stock</Badge>;
  if (level === "TEMPORARILY_OUT_OF_STOCK")
    return <Badge variant="red">Out of Stock</Badge>;
  return <Badge variant="green">In Stock</Badge>;
}

function ProductDetailView() {
  const [data, setData] = useState<ProductDetailContent | null>(null);

  const { app, isConnected, error } = useApp({
    appInfo: { name: "product-detail", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (appInstance) => {
      appInstance.ontoolresult = (result) => {
        const content = result.structuredContent as
          | ProductDetailContent
          | undefined;
        if (content?.product) {
          setData(content);
        }
      };
      appInstance.onerror = console.error;
    },
  });

  if (error) {
    return <div className="empty-state">Error: {error.message}</div>;
  }
  if (!isConnected || !data) {
    return <div id="loading">Loading...</div>;
  }

  const { product } = data;
  const name = product.description || "Unknown Product";
  const brand = product.brand;
  const upc = product.upc;

  const handleAddToCart = (productUpc: string, qty: number) => {
    app?.callServerTool({
      name: "add_to_cart",
      arguments: { upc: productUpc, quantity: qty },
    });
  };

  const handleAddToList = (productName: string, productUpc: string) => {
    app?.callServerTool({
      name: "manage_shopping_list",
      arguments: {
        action: "add",
        items: [{ productName, upc: productUpc, quantity: 1 }],
      },
    });
  };

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
            onClick={() => handleAddToCart(upc, 1)}
          >
            Add to Cart
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => handleAddToList(name, upc)}
          >
            + Shopping List
          </button>
        </div>
      )}

      {product.items && product.items.length > 0 && (
        <div className="detail-section">
          <div className="detail-label">Options</div>
          {product.items.map((item) => (
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

createRoot(document.getElementById("root")!).render(<ProductDetailView />);

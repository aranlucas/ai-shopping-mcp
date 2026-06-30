import type { App } from "@modelcontextprotocol/ext-apps/react";

import { Badge, FulfillmentTags, PriceDisplay, ProductActions } from "../../shared/components.js";
import { type ProductDetailContent } from "../../shared/types.js";
import { addProductToCart, saveProductToList } from "../tool-calls.js";

function StockBadge({ level }: { level: string | undefined }) {
  if (!level) return null;
  if (level === "LOW") return <Badge variant="yellow">Low Stock</Badge>;
  if (level === "TEMPORARILY_OUT_OF_STOCK") return <Badge variant="red">Out of Stock</Badge>;
  return <Badge variant="green">In Stock</Badge>;
}

export function ProductDetailView({
  data,
  app,
  canCallTools,
}: {
  data: ProductDetailContent;
  app: App | null;
  canCallTools: boolean;
}) {
  const { product } = data;
  const name = product.description || "Unknown Product";
  const brand = product.brand;
  const upc = product.upc;

  const handleAddToCart = async (productName: string, productUpc: string, quantity: number) => {
    await addProductToCart(app, {
      listName: `Cart: ${productName}`,
      productName,
      quantity,
      upc: productUpc,
    });
  };

  const handleAddToList = async (productName: string, productUpc: string) => {
    await saveProductToList(app, {
      productName,
      quantity: 1,
      upc: productUpc,
    });
  };

  return (
    <div className="px-3.5 py-3 max-w-2xl mx-auto animate-view-in">
      <div className="bg-[var(--app-card-bg)] rounded-lg border border-[var(--app-border)] overflow-hidden">
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-[var(--app-border)]">
          <h1 className="text-sm font-semibold text-gray-900 leading-snug">{name}</h1>
          {brand && <p className="text-[11px] text-gray-400 mt-0.5">{brand}</p>}
          <div className="mt-2.5 flex items-center gap-3 flex-wrap">
            <PriceDisplay product={product} />
            <FulfillmentTags product={product} />
          </div>
        </div>

        {/* Actions */}
        {upc && (
          <div className="px-4 py-3 border-b border-[var(--app-border)] flex gap-1.5">
            <ProductActions
              upc={upc}
              name={name}
              disabled={!canCallTools}
              onAddToCart={handleAddToCart}
              onAddToList={handleAddToList}
            />
          </div>
        )}

        {/* Details */}
        <div className="px-4 py-3 space-y-3.5">
          {product.items && product.items.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                Options
              </p>
              <div className="space-y-1">
                {product.items.map((item) => (
                  <div
                    key={item.size ?? item.itemId}
                    className="flex items-center gap-2 text-xs text-gray-700"
                  >
                    {item.size && <span>{item.size}</span>}
                    {item.price?.regular && (
                      <span className="text-gray-400 font-mono">
                        ${item.price.regular.toFixed(2)}
                      </span>
                    )}
                    <StockBadge level={item.inventory?.stockLevel} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {product.categories && product.categories.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                Category
              </p>
              <div className="flex flex-wrap gap-1">
                {product.categories.map((c) => (
                  <Badge key={c} variant="gray">
                    {c}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {product.aisleLocations && product.aisleLocations.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                Aisle
              </p>
              {product.aisleLocations.map((loc) => (
                <div key={loc.description ?? loc.number} className="text-xs text-gray-600">
                  {loc.description} {loc.number ? `(${loc.number})` : ""}
                </div>
              ))}
            </div>
          )}

          {upc && (
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                UPC
              </p>
              <p className="text-xs text-gray-400 font-mono">{upc}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import type { App } from "@modelcontextprotocol/ext-apps/react";

import { Badge, FulfillmentTags, PriceDisplay, ProductActions } from "../../shared/components.js";
import { type ProductDetailContent } from "../../shared/types.js";
import { addProductToCart, saveProductToList } from "../tool-calls.js";

function StockBadge({ level }: { level: string | undefined }) {
  if (!level) return null;
  if (level === "LOW")
    return (
      <Badge variant="outline" className="bg-amber-50 text-amber-700">
        Low Stock
      </Badge>
    );
  if (level === "TEMPORARILY_OUT_OF_STOCK")
    return (
      <Badge variant="outline" className="bg-red-50 text-red-600">
        Out of Stock
      </Badge>
    );
  return (
    <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">
      In Stock
    </Badge>
  );
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
    <div className="mx-auto max-w-2xl animate-in px-3.5 py-3 fade-in slide-in-from-bottom-1">
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {/* Header */}
        <div className="border-b border-border px-4 pt-4 pb-3">
          <h1 className="text-sm leading-snug font-semibold text-gray-900">{name}</h1>
          {brand && <p className="mt-0.5 text-xs text-gray-400">{brand}</p>}
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <PriceDisplay product={product} />
            <FulfillmentTags product={product} />
          </div>
        </div>

        {/* Actions */}
        {upc && (
          <div className="flex gap-1.5 border-b border-border px-4 py-3">
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
        <div className="flex flex-col gap-3.5 px-4 py-3">
          {product.items && product.items.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold tracking-wider text-gray-400 uppercase">
                Options
              </p>
              <div className="flex flex-col gap-1">
                {product.items.map((item) => (
                  <div
                    key={item.size ?? item.itemId}
                    className="flex items-center gap-2 text-xs text-gray-700"
                  >
                    {item.size && <span>{item.size}</span>}
                    {item.price?.regular && (
                      <span className="font-mono text-gray-400">
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
              <p className="mb-1.5 text-xs font-semibold tracking-wider text-gray-400 uppercase">
                Category
              </p>
              <div className="flex flex-wrap gap-1">
                {product.categories.map((c) => (
                  <Badge key={c} variant="secondary" className="bg-gray-100 text-gray-500">
                    {c}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {product.aisleLocations && product.aisleLocations.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold tracking-wider text-gray-400 uppercase">
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
              <p className="mb-1 text-xs font-semibold tracking-wider text-gray-400 uppercase">
                UPC
              </p>
              <p className="font-mono text-xs text-gray-400">{upc}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

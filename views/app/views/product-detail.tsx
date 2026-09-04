import type { App } from "@modelcontextprotocol/ext-apps/react";

import { useCallback } from "react";

import { Badge, FulfillmentTags, PriceDisplay, ProductActions } from "../../shared/components.js";
import { type ProductDetailContent } from "../../shared/types.js";
import { addProductToCart, saveProductToList } from "../tool-calls.js";

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
  const name = product.name;
  const brand = product.brand;
  const productRef = `${product.product.provider}:${product.product.id}`;

  const handleAddToCart = useCallback(
    async (productName: string, selectedProductRef: string, quantity: number) => {
      await addProductToCart(app, {
        listName: `Cart: ${productName}`,
        productName,
        quantity,
        productRef: selectedProductRef,
      });
    },
    [app],
  );

  const handleAddToList = useCallback(
    async (productName: string, selectedProductRef: string) => {
      await saveProductToList(app, {
        productName,
        quantity: 1,
        productRef: selectedProductRef,
      });
    },
    [app],
  );

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
        <div className="flex gap-1.5 border-b border-border px-4 py-3">
          <ProductActions
            productRef={productRef}
            cartEnabled={product.product.provider === "kroger"}
            name={name}
            disabled={!canCallTools}
            onAddToCart={handleAddToCart}
            onAddToList={handleAddToList}
          />
        </div>

        {/* Details */}
        <div className="flex flex-col gap-3.5 px-4 py-3">
          {product.size && (
            <div>
              <p className="mb-1.5 text-xs font-semibold tracking-wider text-gray-400 uppercase">
                Options
              </p>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-xs text-gray-700">
                  <span>{product.size}</span>
                </div>
              </div>
            </div>
          )}

          {product.category && (
            <div>
              <p className="mb-1.5 text-xs font-semibold tracking-wider text-gray-400 uppercase">
                Category
              </p>
              <div className="flex flex-wrap gap-1">
                <Badge variant="secondary" className="bg-gray-100 text-gray-500">
                  {product.category}
                </Badge>
              </div>
            </div>
          )}

          {product.aisle && (
            <div>
              <p className="mb-1.5 text-xs font-semibold tracking-wider text-gray-400 uppercase">
                Aisle
              </p>
              <div className="text-xs text-gray-600">
                {product.aisle.description}{" "}
                {product.aisle.number ? `(${product.aisle.number})` : ""}
              </div>
            </div>
          )}

          <div>
            <p className="mb-1 text-xs font-semibold tracking-wider text-gray-400 uppercase">
              Product reference
            </p>
            <p className="font-mono text-xs text-gray-400">{productRef}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

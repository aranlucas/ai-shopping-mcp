import { type ShoppingAppClient, type ProductDetailContent } from "../../shared/types.js";

import { useCallback } from "react";

import {
  Badge,
  ExternalLink,
  FulfillmentTags,
  PriceDisplay,
  ProductActions,
  type SaveProductToList,
} from "../../shared/components.js";
import { saveProductToList } from "../tool-calls.js";

type ProductDetailViewProps = {
  data: ProductDetailContent;
  app: ShoppingAppClient | null;
  canCallTools: boolean;
};

export function ProductDetailView({ data, app, canCallTools }: ProductDetailViewProps) {
  const { product } = data;
  const name = product.name;
  const brand = product.brand;
  const upc = product.upc;

  const handleAddToList = useCallback<SaveProductToList>(
    (item, listId) => saveProductToList(app, item, listId),
    [app],
  );

  return (
    <div className="mx-auto max-w-2xl animate-in px-3.5 py-3 fade-in slide-in-from-bottom-1">
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {/* Header */}
        <div className="border-be border-border px-4 pbs-4 pbe-3">
          <h1 className="text-sm leading-snug font-semibold text-gray-900">{name}</h1>
          {brand && <p className="mbs-0.5 text-xs text-gray-400">{brand}</p>}
          <div className="mbs-2.5 flex flex-wrap items-center gap-3">
            <PriceDisplay product={product} />
            <FulfillmentTags product={product} />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-1.5 border-be border-border px-4 py-3">
          <ProductActions
            app={app}
            upc={upc}
            cartDisabled={!product.available}
            name={name}
            price={product.price}
            disabled={!canCallTools}
            onAddToList={handleAddToList}
          />
        </div>
        {product.url && (
          <div className="border-be border-border px-4 py-3">
            <ExternalLink app={app} href={product.url}>
              Open in Kroger
            </ExternalLink>
          </div>
        )}

        {/* Details */}
        <div className="flex flex-col gap-3.5 px-4 py-3">
          {product.size && (
            <div>
              <p className="mbe-1.5 text-xs font-semibold tracking-wider text-gray-400 uppercase">
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
              <p className="mbe-1.5 text-xs font-semibold tracking-wider text-gray-400 uppercase">
                Category
              </p>
              <div className="flex flex-wrap gap-1">
                <Badge variant="secondary" tone="muted">
                  {product.category}
                </Badge>
              </div>
            </div>
          )}

          {product.aisle && (
            <div>
              <p className="mbe-1.5 text-xs font-semibold tracking-wider text-gray-400 uppercase">
                Aisle
              </p>
              <div className="text-xs text-gray-600">
                {product.aisle.description}{" "}
                {product.aisle.number ? `(${product.aisle.number})` : ""}
              </div>
            </div>
          )}

          <div>
            <p className="mbe-1 text-xs font-semibold tracking-wider text-gray-400 uppercase">
              UPC
            </p>
            <p className="font-mono text-xs text-gray-400">{upc}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

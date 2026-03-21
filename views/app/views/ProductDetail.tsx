import type { App } from "@modelcontextprotocol/ext-apps/react";
import { useState } from "react";
import {
  ActionButton,
  Badge,
  FulfillmentTags,
  PriceDisplay,
} from "../../shared/components.js";
import { callTool, type ProductDetailContent } from "../../shared/types.js";

function StockBadge({ level }: { level: string | undefined }) {
  if (!level) return null;
  if (level === "LOW") return <Badge variant="yellow">Low Stock</Badge>;
  if (level === "TEMPORARILY_OUT_OF_STOCK")
    return <Badge variant="red">Out of Stock</Badge>;
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
  const [cartState, setCartState] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [listState, setListState] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");

  const { product } = data;
  const name = product.description || "Unknown Product";
  const brand = product.brand;
  const upc = product.upc;

  const handleAddToCart = async () => {
    if (!upc) return;
    setCartState("loading");
    try {
      const result = await callTool(app, {
        name: "add_to_cart",
        arguments: { items: [{ upc, quantity: 1, modality: "PICKUP" }] },
      });
      if (result?.isError) throw new Error("Failed");
      setCartState("done");
      setTimeout(() => setCartState("idle"), 2000);
    } catch {
      setCartState("error");
      setTimeout(() => setCartState("idle"), 2000);
    }
  };

  const handleAddToList = async () => {
    if (!upc) return;
    setListState("loading");
    try {
      const result = await callTool(app, {
        name: "manage_shopping_list",
        arguments: {
          action: "add",
          items: [{ productName: name, upc, quantity: 1 }],
        },
      });
      if (result?.isError) throw new Error("Failed");
      setListState("done");
      setTimeout(() => setListState("idle"), 2000);
    } catch {
      setListState("error");
      setTimeout(() => setListState("idle"), 2000);
    }
  };

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm dark:bg-gray-800/80 dark:border-gray-700/60 overflow-hidden">
        <div className="px-5 pt-5 pb-4 border-b border-gray-100 dark:border-gray-700/50">
          <h1 className="text-base font-bold text-gray-900 dark:text-gray-100 leading-snug">
            {name}
          </h1>
          {brand && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {brand}
            </p>
          )}
          <div className="mt-2.5 flex items-center gap-3 flex-wrap">
            <PriceDisplay product={product} />
            <FulfillmentTags product={product} />
          </div>
        </div>

        {upc && (
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700/50 flex gap-2">
            <ActionButton
              state={cartState}
              onClick={handleAddToCart}
              disabled={!canCallTools}
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
              onClick={handleAddToList}
              disabled={!canCallTools}
              idleLabel="Save to List"
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
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 4.5v15m7.5-7.5h-15"
                  />
                </svg>
              }
            />
          </div>
        )}

        <div className="px-5 py-4 space-y-4">
          {product.items && product.items.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
                Options
              </p>
              <div className="space-y-1.5">
                {product.items.map((item) => (
                  <div
                    key={item.size ?? item.itemId}
                    className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"
                  >
                    {item.size && <span>{item.size}</span>}
                    {item.price?.regular && (
                      <span className="text-gray-400 dark:text-gray-500">
                        &middot; ${item.price.regular.toFixed(2)}
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
              <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
                Category
              </p>
              <div className="flex flex-wrap gap-1.5">
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
              <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
                Aisle Location
              </p>
              {product.aisleLocations.map((loc) => (
                <div
                  key={loc.description ?? loc.number}
                  className="text-sm text-gray-600 dark:text-gray-300"
                >
                  {loc.description} {loc.number ? `(${loc.number})` : ""}
                </div>
              ))}
            </div>
          )}

          {upc && (
            <div>
              <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">
                UPC
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 font-mono">
                {upc}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

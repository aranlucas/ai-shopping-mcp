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
    return (
      <div className="text-center py-12 text-gray-400">
        Error: {error.message}
      </div>
    );
  }
  if (!isConnected || !data) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400 gap-2">
        <svg
          aria-hidden="true"
          className="animate-spin h-4 w-4"
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
        Loading...
      </div>
    );
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
    <div className="p-4 max-w-2xl mx-auto">
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200/80">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-gray-900">{name}</h1>
          {brand && <p className="text-sm text-gray-500 mt-1">{brand}</p>}
        </div>

        <div className="mb-3">
          <PriceDisplay product={product} />
        </div>

        <FulfillmentTags product={product} />

        {upc && (
          <div className="flex gap-2 mt-5">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 active:bg-blue-800 transition-colors"
              onClick={() => handleAddToCart(upc, 1)}
            >
              <svg
                aria-hidden="true"
                className="w-4 h-4"
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
              Add to Cart
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-50 px-4 py-2.5 text-sm font-semibold text-gray-700 ring-1 ring-gray-200 hover:bg-gray-100 active:bg-gray-200 transition-colors"
              onClick={() => handleAddToList(name, upc)}
            >
              <svg
                aria-hidden="true"
                className="w-4 h-4"
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
              + Shopping List
            </button>
          </div>
        )}

        {product.items && product.items.length > 0 && (
          <div className="mt-6 pt-5 border-t border-gray-100">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Options
            </h3>
            <div className="space-y-2">
              {product.items.map((item) => (
                <div
                  key={item.size ?? item.itemId}
                  className="flex items-center gap-2 text-sm text-gray-700"
                >
                  {item.size && <span>{item.size}</span>}
                  {item.price?.regular && (
                    <span className="text-gray-400">
                      &middot; ${item.price.regular}
                    </span>
                  )}
                  <StockBadge level={item.inventory?.stockLevel} />
                </div>
              ))}
            </div>
          </div>
        )}

        {product.categories && product.categories.length > 0 && (
          <div className="mt-6 pt-5 border-t border-gray-100">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Category
            </h3>
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
          <div className="mt-6 pt-5 border-t border-gray-100">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Aisle Location
            </h3>
            {product.aisleLocations.map((loc) => (
              <div
                key={loc.description ?? loc.number}
                className="text-sm text-gray-600"
              >
                {loc.description} {loc.number ? `(${loc.number})` : ""}
              </div>
            ))}
          </div>
        )}

        {upc && (
          <div className="mt-6 pt-5 border-t border-gray-100">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
              UPC
            </h3>
            <div className="text-sm text-gray-500 font-mono">{upc}</div>
          </div>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <ProductDetailView />,
);

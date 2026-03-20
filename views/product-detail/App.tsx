import { createRoot } from "react-dom/client";
import {
  Badge,
  FulfillmentTags,
  PriceDisplay,
  ProductActions,
} from "../shared/components.js";
import { ErrorDisplay, Loading } from "../shared/status.js";
import { callTool, type ProductDetailContent } from "../shared/types.js";
import { useMcpView } from "../shared/use-mcp-view.js";

function StockBadge({ level }: { level: string | undefined }) {
  if (!level) return null;
  if (level === "LOW") return <Badge variant="yellow">Low Stock</Badge>;
  if (level === "TEMPORARILY_OUT_OF_STOCK")
    return <Badge variant="red">Out of Stock</Badge>;
  return <Badge variant="green">In Stock</Badge>;
}

function ProductDetailView() {
  const { data, app, isConnected, error } = useMcpView<ProductDetailContent>(
    "product-detail",
    (sc) => !!sc?.product,
  );

  if (error) return <ErrorDisplay message={error.message} />;
  if (!isConnected || !data) return <Loading />;

  const { product } = data;
  const name = product.description || "Unknown Product";
  const brand = product.brand;
  const upc = product.upc;

  const handleAddToCart = async (productUpc: string, qty: number) => {
    const result = await callTool(app, {
      name: "add_to_cart",
      arguments: {
        items: [{ upc: productUpc, quantity: qty, modality: "PICKUP" }],
      },
    });
    if (result?.isError) {
      throw new Error("Failed to add to cart");
    }
  };

  const handleAddToList = async (productName: string, productUpc: string) => {
    const result = await callTool(app, {
      name: "manage_shopping_list",
      arguments: {
        action: "add",
        items: [{ productName, upc: productUpc, quantity: 1 }],
      },
    });
    if (result?.isError) {
      throw new Error("Failed to add to list");
    }
  };

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200/80 dark:bg-gray-800 dark:border-gray-700/80">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {name}
          </h1>
          {brand && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {brand}
            </p>
          )}
        </div>

        <div className="mb-3">
          <PriceDisplay product={product} />
        </div>

        <FulfillmentTags product={product} />

        <ProductActions
          upc={upc}
          name={name}
          onAddToCart={handleAddToCart}
          onAddToList={handleAddToList}
        />

        {product.items && product.items.length > 0 && (
          <div className="mt-6 pt-5 border-t border-gray-100 dark:border-gray-700">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
              Options
            </h3>
            <div className="space-y-2">
              {product.items.map((item) => (
                <div
                  key={item.size ?? item.itemId}
                  className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"
                >
                  {item.size && <span>{item.size}</span>}
                  {item.price?.regular && (
                    <span className="text-gray-400 dark:text-gray-500">
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
          <div className="mt-6 pt-5 border-t border-gray-100 dark:border-gray-700">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
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
          <div className="mt-6 pt-5 border-t border-gray-100 dark:border-gray-700">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
              Aisle Location
            </h3>
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
          <div className="mt-6 pt-5 border-t border-gray-100 dark:border-gray-700">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
              UPC
            </h3>
            <div className="text-sm text-gray-500 dark:text-gray-400 font-mono">
              {upc}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <ProductDetailView />,
);

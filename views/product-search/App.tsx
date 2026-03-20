import { createRoot } from "react-dom/client";
import {
  Badge,
  FulfillmentTags,
  PriceDisplay,
  ProductActions,
} from "../shared/components.js";
import { ErrorDisplay, Loading } from "../shared/status.js";
import {
  callTool,
  type ProductData,
  type ProductSearchResultsContent,
} from "../shared/types.js";
import { useMcpView } from "../shared/use-mcp-view.js";

function ProductCard({
  product,
  onAddToCart,
  onAddToList,
}: {
  product: ProductData;
  onAddToCart: (upc: string, qty: number) => void;
  onAddToList: (name: string, upc: string) => void;
}) {
  const name = product.description || "Unknown Product";
  const brand = product.brand;
  const upc = product.upc;
  const size = product.items?.[0]?.size;
  const aisle =
    product.aisleLocations?.[0]?.description ||
    (product.aisleLocations?.[0]?.number
      ? `Aisle ${product.aisleLocations[0].number}`
      : undefined);

  return (
    <div className="group bg-white rounded-xl p-4 border border-gray-200/80 shadow-sm hover:shadow-md hover:border-gray-300/80 transition-all duration-200 dark:bg-gray-800 dark:border-gray-700/80 dark:hover:border-gray-600/80">
      <div className="font-semibold text-sm text-gray-900 dark:text-gray-100 leading-snug">
        {name}
      </div>
      {brand && (
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {brand}
        </div>
      )}
      {size && (
        <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
          {size}
        </div>
      )}
      <div className="mt-2">
        <PriceDisplay product={product} />
      </div>
      <FulfillmentTags product={product} />
      {aisle && (
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 flex items-center gap-1">
          <svg
            aria-hidden="true"
            className="w-3 h-3 text-gray-400 dark:text-gray-500"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"
            />
          </svg>
          {aisle}
        </div>
      )}
      {upc && (
        <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 font-mono">
          UPC: {upc}
        </div>
      )}
      <ProductActions
        upc={upc}
        name={name}
        onAddToCart={onAddToCart}
        onAddToList={onAddToList}
      />
    </div>
  );
}

function ProductSearchView() {
  const { data, app, isConnected, error } =
    useMcpView<ProductSearchResultsContent>(
      "product-search",
      (sc) => !!sc?.results,
    );

  if (error) return <ErrorDisplay message={error.message} />;
  if (!isConnected || !data) return <Loading />;

  const { results, totalProducts } = data;

  const handleAddToCart = async (upc: string, qty: number) => {
    const result = await callTool(app, {
      name: "add_to_cart",
      arguments: { items: [{ upc, quantity: qty, modality: "PICKUP" }] },
    });
    if (result?.isError) {
      throw new Error("Failed to add to cart");
    }
  };

  const handleAddToList = async (name: string, upc: string) => {
    const result = await callTool(app, {
      name: "manage_shopping_list",
      arguments: {
        action: "add",
        items: [{ productName: name, upc, quantity: 1 }],
      },
    });
    if (result?.isError) {
      throw new Error("Failed to add to list");
    }
  };

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          Product Search Results
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {results.length} search term(s) &middot; {totalProducts} total
          products
        </p>
      </div>
      {results.map((result) => {
        if (result.failed) {
          return (
            <div
              key={result.term}
              className="bg-red-50 rounded-xl p-4 mb-4 border border-red-100 text-sm text-red-600 dark:bg-red-950 dark:border-red-900 dark:text-red-400"
            >
              Search failed for &ldquo;{result.term}&rdquo;
            </div>
          );
        }
        if (result.products.length === 0) {
          return (
            <div key={result.term} className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                  {result.term}
                </h2>
                <Badge variant="gray">0 items</Badge>
              </div>
              <p className="text-sm text-gray-400 dark:text-gray-500">
                No products found.
              </p>
            </div>
          );
        }
        return (
          <div key={result.term} className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                {result.term}
              </h2>
              <Badge variant="blue">{result.products.length} items</Badge>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {result.products.map((product) => (
                <ProductCard
                  key={product.upc ?? product.description}
                  product={product}
                  onAddToCart={handleAddToCart}
                  onAddToList={handleAddToList}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <ProductSearchView />,
);

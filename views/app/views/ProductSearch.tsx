import type { App } from "@modelcontextprotocol/ext-apps/react";
import {
  Badge,
  FulfillmentTags,
  PriceDisplay,
  ProductActions,
  SectionHeader,
} from "../../shared/components.js";
import { EmptyState } from "../../shared/status.js";
import {
  callTool,
  type ProductData,
  type ProductSearchResultsContent,
} from "../../shared/types.js";

function ProductCard({
  product,
  canCallTools,
  onAddToCart,
  onAddToList,
}: {
  product: ProductData;
  canCallTools: boolean;
  onAddToCart: (upc: string, qty: number) => Promise<void>;
  onAddToList: (name: string, upc: string) => Promise<void>;
}) {
  const name = product.description || "Unknown Product";
  const brand = product.brand;
  const upc = product.upc;
  const size = product.items?.[0]?.size;
  const aisle =
    product.aisleLocations?.[0]?.description ||
    (product.aisleLocations?.[0]?.number ? `Aisle ${product.aisleLocations[0].number}` : undefined);

  return (
    <div className="bg-[var(--app-card-bg)] rounded-lg border border-[var(--app-border)] hover:border-[var(--app-border-hover)] hover:shadow-sm transition-all duration-150 flex flex-col overflow-hidden">
      <div className="p-3 flex-1">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="font-medium text-[13px] text-gray-900 leading-snug">{name}</div>
            {(brand || size) && (
              <div className="text-[11px] text-gray-400 mt-0.5">
                {brand}
                {brand && size && " · "}
                {size}
              </div>
            )}
            {aisle && (
              <div className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-0.5">
                <svg
                  aria-hidden="true"
                  className="w-2.5 h-2.5 shrink-0"
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
          </div>
          <div className="shrink-0">
            <PriceDisplay product={product} />
          </div>
        </div>
        <FulfillmentTags product={product} />
        {upc && <div className="text-[9px] text-gray-300 mt-1 font-mono">{upc}</div>}
      </div>
      <ProductActions
        upc={upc}
        name={name}
        disabled={!canCallTools}
        onAddToCart={onAddToCart}
        onAddToList={onAddToList}
      />
    </div>
  );
}

export function ProductSearchView({
  data,
  app,
  canCallTools,
}: {
  data: ProductSearchResultsContent;
  app: App | null;
  canCallTools: boolean;
}) {
  const { results, totalProducts } = data;

  const handleAddToCart = async (upc: string, qty: number) => {
    const result = await callTool(app, {
      name: "add_to_cart",
      arguments: { items: [{ upc, quantity: qty, modality: "PICKUP" }] },
    });
    if (result?.isError) {
      const msg =
        result.content
          ?.map((c) => ("text" in c ? c.text : ""))
          .filter(Boolean)
          .join(" ") || "Failed to add to cart";
      throw new Error(msg);
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
      const msg =
        result.content
          ?.map((c) => ("text" in c ? c.text : ""))
          .filter(Boolean)
          .join(" ") || "Failed to add to list";
      throw new Error(msg);
    }
  };

  const hasResults = results.some((r) => !r.failed && r.products.length > 0);

  return (
    <div className="px-3.5 py-3 max-w-4xl mx-auto animate-view-in">
      <SectionHeader
        title="Product Search"
        badge={<span className="text-[11px] text-gray-400 font-mono">{totalProducts} items</span>}
        subtitle={`${results.length} search term${results.length !== 1 ? "s" : ""}`}
      />

      {!hasResults && (
        <EmptyState
          icon={
            <svg
              aria-hidden="true"
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
              />
            </svg>
          }
          message="No products found"
          description="Try different search terms or check your store location."
        />
      )}

      {results.map((result) => {
        if (result.failed) {
          return (
            <div
              key={result.term}
              className="bg-red-50 rounded-lg px-3 py-2 mb-4 border border-red-100 text-xs text-red-600 flex items-center gap-1.5"
            >
              <svg
                aria-hidden="true"
                className="w-3.5 h-3.5 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
                />
              </svg>
              Search failed for &ldquo;{result.term}&rdquo;
            </div>
          );
        }
        if (result.products.length === 0) {
          return (
            <div key={result.term} className="mb-5">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  {result.term}
                </span>
                <span className="text-[11px] text-gray-300">·</span>
                <span className="text-[11px] text-gray-400">No results</span>
              </div>
            </div>
          );
        }
        return (
          <div key={result.term} className="mb-6">
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                {result.term}
              </span>
              <span className="text-[11px] text-gray-300">·</span>
              <span className="text-[11px] text-gray-400">{result.products.length} items</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {result.products.map((product) => (
                <ProductCard
                  key={product.upc ?? product.description}
                  product={product}
                  onAddToCart={handleAddToCart}
                  onAddToList={handleAddToList}
                  canCallTools={canCallTools}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

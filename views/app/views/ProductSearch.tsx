import type { App } from "@modelcontextprotocol/ext-apps/react";
import { ProductCard, SectionHeader } from "../../shared/components.js";
import { EmptyState } from "../../shared/status.js";
import { callTool, type ProductSearchResultsContent } from "../../shared/types.js";

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

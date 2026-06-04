import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps/react";

import { useRef } from "react";

import { DisplayModeToggle, ProductCard, SectionHeader } from "../../shared/components.js";
import { EmptyState } from "../../shared/status.js";
import {
  type ProductData,
  type ProductSearchResultsContent,
  callTool,
} from "../../shared/types.js";

function ProductCarousel({
  products,
  onAddToCart,
  onAddToList,
  canCallTools,
}: {
  products: ProductData[];
  onAddToCart: (upc: string, qty: number) => Promise<void>;
  onAddToList: (name: string, upc: string) => Promise<void>;
  canCallTools: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (dir: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "left" ? -220 : 220, behavior: "smooth" });
  };

  return (
    <div className="relative group">
      <button
        type="button"
        onClick={() => scroll("left")}
        aria-label="Scroll left"
        className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 z-10 w-6 h-6 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-500 hover:text-gray-800 hover:shadow-md transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 cursor-pointer"
      >
        <svg
          aria-hidden="true"
          className="w-3 h-3"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
        </svg>
      </button>

      <div
        ref={scrollRef}
        className="flex gap-2 overflow-x-auto pb-1 scroll-smooth"
        style={{ scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}
      >
        {products.map((product) => (
          <div
            key={product.upc ?? product.description}
            className="shrink-0 w-52"
            style={{ scrollSnapAlign: "start" }}
          >
            <ProductCard
              product={product}
              onAddToCart={onAddToCart}
              onAddToList={onAddToList}
              canCallTools={canCallTools}
            />
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => scroll("right")}
        aria-label="Scroll right"
        className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1 z-10 w-6 h-6 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-500 hover:text-gray-800 hover:shadow-md transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 cursor-pointer"
      >
        <svg
          aria-hidden="true"
          className="w-3 h-3"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
        </svg>
      </button>
    </div>
  );
}

export function ProductSearchView({
  data,
  app,
  canCallTools,
  hostContext,
}: {
  data: ProductSearchResultsContent;
  app: App | null;
  canCallTools: boolean;
  hostContext?: McpUiHostContext;
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
        trailing={<DisplayModeToggle app={app} hostContext={hostContext} />}
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
            <ProductCarousel
              products={result.products}
              onAddToCart={handleAddToCart}
              onAddToList={handleAddToList}
              canCallTools={canCallTools}
            />
          </div>
        );
      })}
    </div>
  );
}

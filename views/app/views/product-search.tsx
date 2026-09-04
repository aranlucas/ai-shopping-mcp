import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps/react";

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@agents/ui/components/carousel";

import { DisplayModeToggle, ProductCard, SectionHeader } from "../../shared/components.js";
import { EmptyState } from "../../shared/status.js";
import { type ProductData, type ProductSearchResultsContent } from "../../shared/types.js";
import { addProductToCart, saveProductToList } from "../tool-calls.js";

function ProductCarousel({
  products,
  onAddToCart,
  onAddToList,
  canCallTools,
}: {
  products: ProductData[];
  onAddToCart: (name: string, productRef: string, qty: number) => Promise<void>;
  onAddToList: (name: string, productRef: string) => Promise<void>;
  canCallTools: boolean;
}) {
  return (
    <Carousel opts={{ align: "start" }}>
      <CarouselContent className="-ms-2">
        {products.map((product) => (
          <CarouselItem
            key={`${product.product.provider}:${product.product.id}`}
            className="basis-52 ps-2"
          >
            <ProductCard
              product={product}
              onAddToCart={onAddToCart}
              onAddToList={onAddToList}
              canCallTools={canCallTools}
            />
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious className="inset-s-2 border-gray-200 bg-white/90 shadow-md hover:bg-white" />
      <CarouselNext className="inset-e-2 border-gray-200 bg-white/90 shadow-md hover:bg-white" />
    </Carousel>
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

  const handleAddToCart = async (name: string, productRef: string, qty: number) => {
    await addProductToCart(app, {
      listName: `Cart: ${name}`,
      productName: name,
      quantity: qty,
      productRef,
    });
  };

  const handleAddToList = async (name: string, productRef: string) => {
    await saveProductToList(app, {
      productName: name,
      quantity: 1,
      productRef,
    });
  };

  const hasResults = results.some((r) => !r.failed && r.products.length > 0);

  return (
    <div className="mx-auto max-w-4xl animate-in px-3.5 py-3 fade-in slide-in-from-bottom-1">
      <SectionHeader
        title="Product Search"
        badge={<span className="font-mono text-xs text-gray-400">{totalProducts} items</span>}
        subtitle={`${results.length} search term${results.length !== 1 ? "s" : ""}`}
        trailing={<DisplayModeToggle app={app} hostContext={hostContext} />}
      />

      {!hasResults && (
        <EmptyState
          icon={
            <svg
              aria-hidden="true"
              className="size-5"
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
              key={`${result.provider}:${result.term}`}
              className="mb-4 flex items-center gap-1.5 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600"
            >
              <svg
                aria-hidden="true"
                className="size-3.5 shrink-0"
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
            <div key={`${result.provider}:${result.term}`} className="mb-5">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-xs font-semibold tracking-wider text-gray-500 uppercase">
                  {result.term} · {result.provider}
                </span>
                <span className="text-xs text-gray-300">·</span>
                <span className="text-xs text-gray-400">No results</span>
              </div>
            </div>
          );
        }
        return (
          <div key={`${result.provider}:${result.term}`} className="mb-6">
            <div className="mb-2.5 flex items-center gap-2">
              <span className="text-xs font-semibold tracking-wider text-gray-500 uppercase">
                {result.term}
              </span>
              <span className="text-xs text-gray-300">·</span>
              <span className="text-xs text-gray-400">{result.products.length} items</span>
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

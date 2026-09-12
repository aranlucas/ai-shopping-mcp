import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps/react";

import { useCallback, useMemo } from "react";

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@agents/ui/components/carousel";

import { Badge, DisplayModeToggle, ProductCard, SectionHeader } from "../../shared/components.js";
import { EmptyState } from "../../shared/status.js";
import { type ProductData, type ProductSearchResultsContent } from "../../shared/types.js";
import { addProductToCart, saveProductToList } from "../tool-calls.js";

const CAROUSEL_OPTS = { align: "start" } as const;

const EMPTY_SEARCH_ICON = (
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
);

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
    <Carousel opts={CAROUSEL_OPTS} aria-label="Products">
      <CarouselContent className="-ms-2">
        {products.map((product) => (
          <CarouselItem
            key={`${product.product.provider}:${product.product.id}`}
            className="basis-68 ps-2"
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
      {products.length > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2">
          <span className="me-auto text-xs text-gray-500">Swipe or use the arrows to compare</span>
          <CarouselPrevious size="icon-lg" className="static translate-y-0" />
          <CarouselNext size="icon-lg" className="static translate-y-0" />
        </div>
      )}
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

  const handleAddToCart = useCallback(
    async (name: string, productRef: string, qty: number) => {
      await addProductToCart(app, {
        listName: `Cart: ${name}`,
        productName: name,
        quantity: qty,
        productRef,
      });
    },
    [app],
  );

  const handleAddToList = useCallback(
    async (name: string, productRef: string) => {
      await saveProductToList(app, {
        productName: name,
        quantity: 1,
        productRef,
      });
    },
    [app],
  );

  const hasResults = results.some((r) => !r.failed && r.products.length > 0);

  const headerBadge = useMemo(
    () => <Badge variant="secondary">{totalProducts} items</Badge>,
    [totalProducts],
  );
  const headerTrailing = useMemo(
    () => <DisplayModeToggle app={app} hostContext={hostContext} />,
    [app, hostContext],
  );
  const headerSubtitle = useMemo(
    () => `${results.length} search term${results.length !== 1 ? "s" : ""}`,
    [results.length],
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6">
      <SectionHeader
        title="Product Search"
        badge={headerBadge}
        subtitle={headerSubtitle}
        trailing={headerTrailing}
      />

      {!hasResults && !results.some((result) => result.failed) && (
        <EmptyState
          icon={EMPTY_SEARCH_ICON}
          message="No products found"
          description="Try different search terms or check your store location."
        />
      )}

      {results.map((result) => {
        if (result.failed) {
          return (
            <div
              key={`${result.provider}:${result.term}`}
              role="alert"
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
              Could not search {result.provider} for &ldquo;{result.term}&rdquo;. Ask your assistant
              to retry.
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
          <section key={`${result.provider}:${result.term}`} className="mb-7 last:mb-0">
            <div className="mb-3 flex flex-wrap items-baseline gap-2">
              <h2 className="text-sm font-semibold text-gray-900">{result.term}</h2>
              <span className="text-xs text-gray-500">
                {result.provider} · {result.products.length} items
              </span>
            </div>
            <ProductCarousel
              products={result.products}
              onAddToCart={handleAddToCart}
              onAddToList={handleAddToList}
              canCallTools={canCallTools}
            />
          </section>
        );
      })}
    </div>
  );
}

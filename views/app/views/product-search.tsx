import type { ShoppingAppClient, ProductSearchResultsContent } from "../../shared/types.js";
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps/react";

import { CircleAlertIcon, SearchIcon } from "lucide-react";
import { useCallback, useMemo } from "react";

import {
  DisplayModeToggle,
  ProductCard,
  type SaveProductToList,
  SectionHeader,
} from "../../shared/components.js";
import { EmptyState } from "../../shared/status.js";
import { Alert, AlertDescription, AlertTitle } from "../../shared/ui/alert";
import { saveProductToList } from "../tool-calls.js";

type ProductSearchViewProps = {
  data: ProductSearchResultsContent;
  app: ShoppingAppClient | null;
  canCallTools: boolean;
  hostContext?: McpUiHostContext;
};

const EMPTY_SEARCH_ICON = <SearchIcon aria-hidden="true" className="size-5" />;

export function ProductSearchView({
  data,
  app,
  canCallTools,
  hostContext,
}: ProductSearchViewProps) {
  const { results, totalProducts } = data;

  const handleAddToList = useCallback<SaveProductToList>(
    (product, listId) => saveProductToList(app, product, listId),
    [app],
  );

  const headerTrailing = useMemo(
    () => <DisplayModeToggle app={app} hostContext={hostContext} />,
    [app, hostContext],
  );

  const hasResults = results.some((result) => !result.failed && result.products.length > 0);
  const hasFailures = results.some((result) => result.failed);
  const productCount = `${totalProducts} ${totalProducts === 1 ? "product" : "products"}`;
  const termCount = `${results.length} search ${results.length === 1 ? "term" : "terms"}`;

  return (
    <div className="@container mx-auto max-w-4xl p-4 sm:px-6">
      <SectionHeader
        title="Product Search"
        subtitle={`${productCount} · ${termCount}`}
        trailing={headerTrailing}
      />

      {!hasResults && !hasFailures && (
        <EmptyState
          icon={EMPTY_SEARCH_ICON}
          message="No products found"
          description="Try different search terms or check your store location."
        />
      )}

      <div className="divide-y divide-border border-bs border-border">
        {results.map((result) => {
          const key = result.requestId ?? result.term;
          const count = result.products.length;

          if (result.failed) {
            return (
              <div key={key} className="py-3">
                <Alert variant="destructive">
                  <CircleAlertIcon aria-hidden="true" />
                  <AlertTitle>Could not search for &ldquo;{result.term}&rdquo;</AlertTitle>
                  <AlertDescription>
                    {result.error ?? "Ask your assistant to retry."}
                  </AlertDescription>
                </Alert>
              </div>
            );
          }

          return (
            <section key={key} className="py-3">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <h2 className="min-w-0 text-sm font-semibold wrap-anywhere text-foreground">
                  {result.term}
                </h2>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {count === 0 ? "No matches" : `${count} ${count === 1 ? "match" : "matches"}`}
                </span>
              </div>
              {count > 0 && (
                <ul className="mbs-2.5 grid gap-3 @xl:grid-cols-2">
                  {result.products.map((product) => (
                    <li key={product.upc} className="min-w-0 only:col-span-full">
                      <ProductCard
                        app={app}
                        product={product}
                        onAddToList={handleAddToList}
                        canCallTools={canCallTools}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

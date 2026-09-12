import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps/react";
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@agents/ui/components/badge";
import { Button } from "@agents/ui/components/button";
import { Card, CardContent, CardFooter } from "@agents/ui/components/card";
import { ActionButton, DisplayModeToggle, SectionHeader } from "../../shared/components.js";
import { useResettableState } from "../../shared/hooks.js";
import { EmptyState } from "../../shared/status.js";
import {
  type DealData,
  type ProductSearchResultsContent,
  type WeeklyDealsContent,
  callTool,
  parseToolResult,
  sendUserMessage,
} from "../../shared/types.js";
import { toolResultErrorMessage } from "../tool-calls.js";
import { ProductSearchView } from "./product-search.js";

const SEARCH_ICON = (
  <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
    />
  </svg>
);

const EMPTY_DEALS_ICON = (
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
      d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z"
    />
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6Z" />
  </svg>
);

function DealCard({
  deal,
  canCallTools,
  canMessage,
  onSearch,
  onPlanMeal,
}: {
  deal: DealData;
  canCallTools: boolean;
  canMessage: boolean;
  onSearch: (title: string) => Promise<void>;
  onPlanMeal: (title: string) => Promise<void>;
}) {
  const [searchState, setSearchState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [planState, setPlanState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const handleSearch = useCallback(async () => {
    setSearchState("loading");
    setError(null);
    try {
      await onSearch(deal.title);
      setSearchState("done");
    } catch (cause) {
      setSearchState("error");
      setError(cause instanceof Error ? cause.message : "Product search failed. Try again.");
    }
  }, [deal.title, onSearch]);
  const handlePlanMeal = useCallback(async () => {
    setPlanState("loading");
    setError(null);
    try {
      await onPlanMeal(deal.title);
      setPlanState("done");
    } catch (cause) {
      setPlanState("error");
      setError(cause instanceof Error ? cause.message : "Could not ask the assistant. Try again.");
    }
  }, [deal.title, onPlanMeal]);

  return (
    <Card size="sm" className="h-full gap-4">
      <CardContent className="flex-1">
        <h3 className="text-base leading-snug font-semibold text-gray-900">{deal.title}</h3>
        {deal.details && (
          <p className="mt-1.5 text-sm leading-relaxed text-gray-500">{deal.details}</p>
        )}
        <div className="mt-4 flex flex-wrap items-baseline gap-2">
          <span className="text-xl leading-snug font-semibold text-emerald-600 tabular-nums">
            {deal.price || "See ad"}
          </span>
          {deal.savings && (
            <Badge variant="outline" className="bg-emerald-50 text-emerald-700">
              {deal.savings}
            </Badge>
          )}
        </div>
      </CardContent>
      <CardFooter className="flex flex-col items-stretch gap-2">
        <div className="flex flex-wrap gap-2">
          <ActionButton
            state={searchState}
            onClick={handleSearch}
            disabled={!canCallTools}
            idleLabel="Find product"
            loadingLabel="Searching…"
            doneLabel="View matches"
            failLabel="Retry search"
            labelContext={deal.title}
            variant="secondary"
            icon={SEARCH_ICON}
          />
          <ActionButton
            state={planState}
            onClick={handlePlanMeal}
            disabled={!canMessage || planState === "done"}
            idleLabel="Plan a meal"
            loadingLabel="Asking…"
            doneLabel="Asked assistant"
            failLabel="Retry request"
            labelContext={deal.title}
            variant="secondary"
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </CardFooter>
    </Card>
  );
}

export function WeeklyDealsView({
  data,
  app,
  canCallTools,
  hostContext,
}: {
  data: WeeklyDealsContent;
  app: App | null;
  canCallTools: boolean;
  hostContext?: McpUiHostContext;
}) {
  const { deals, validFrom, validTill } = data;
  const [category, setCategory] = useResettableState(data, () => "");
  const [searchResult, setSearchResult] = useResettableState(
    data,
    (): ProductSearchResultsContent | null => null,
  );
  const contentRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => {
    const grouped = new Map<string, DealData[]>();
    for (const deal of deals) {
      const entries = grouped.get(deal.category) ?? [];
      entries.push(deal);
      grouped.set(deal.category, entries);
    }
    return [...grouped].map(([name, entries]) => ({ category: name, deals: entries }));
  }, [deals]);
  const visibleGroups = category ? groups.filter((group) => group.category === category) : groups;

  useEffect(() => {
    if (!app || deals.length === 0) return;
    app
      .updateModelContext({
        content: [
          {
            type: "text",
            text: `User is viewing ${deals.length} weekly deals${validFrom && validTill ? ` valid ${validFrom} – ${validTill}` : ""}.`,
          },
        ],
        structuredContent: {
          event: "weekly_deals_viewed",
          count: deals.length,
          validFrom,
          validTill,
        },
      })
      .catch(console.error);
  }, [app, deals.length, validFrom, validTill]);

  useEffect(() => {
    if (searchResult) contentRef.current?.focus();
  }, [searchResult]);

  const handleSearch = useCallback(
    async (title: string) => {
      const result = await callTool(app, {
        name: "search_products",
        arguments: { terms: [title], storeId: data.storeId },
      });
      if (result.isError)
        throw new Error(toolResultErrorMessage(result, "Product search failed. Try again."));
      const parsed = parseToolResult(result);
      if (parsed?.view !== "search_products")
        throw new Error("No product results were returned. Try searching with your assistant.");
      setSearchResult(parsed);
    },
    [app, data.storeId, setSearchResult],
  );
  const handlePlanMeal = useCallback(
    async (title: string) => {
      await sendUserMessage(app, `Plan a quick meal that uses "${title}" from this week's deals.`);
    },
    [app],
  );
  const handleCategoryChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => setCategory(event.target.value),
    [setCategory],
  );
  const handleBack = useCallback(() => setSearchResult(null), [setSearchResult]);
  const headerBadge = useMemo(
    () => <Badge variant="secondary">{deals.length} deals</Badge>,
    [deals.length],
  );
  const headerTrailing = useMemo(
    () => <DisplayModeToggle app={app} hostContext={hostContext} />,
    [app, hostContext],
  );
  const warnings = data.warnings?.length
    ? data.warnings
    : data.cache?.state === "stale"
      ? [
          "Showing saved deals because the latest refresh failed. Check the offer dates before shopping.",
        ]
      : [];

  if (searchResult)
    return (
      <div
        ref={contentRef}
        tabIndex={-1}
        aria-label="Deal product matches"
        className="mx-auto max-w-4xl py-4"
      >
        <div className="px-4 sm:px-6">
          <Button variant="outline" onClick={handleBack}>
            Back to weekly deals
          </Button>
        </div>
        <ProductSearchView
          data={searchResult}
          app={app}
          canCallTools={canCallTools}
          hostContext={hostContext}
        />
      </div>
    );

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6">
      <SectionHeader
        title="Weekly Deals"
        badge={headerBadge}
        subtitle={validFrom && validTill ? `Valid ${validFrom} – ${validTill}` : undefined}
        trailing={headerTrailing}
      />
      {warnings.length > 0 && (
        <div
          role="note"
          aria-label="Deal availability"
          className="mb-5 rounded-lg bg-amber-50 p-3 text-sm leading-relaxed text-amber-700"
        >
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}
      {deals.length === 0 ? (
        <EmptyState
          icon={EMPTY_DEALS_ICON}
          message="No deals found"
          description="Ask your assistant to check another store or try again later."
        />
      ) : (
        <>
          {groups.length > 1 && (
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <label htmlFor="deal-category" className="text-sm font-medium text-gray-700">
                Category
              </label>
              <select
                id="deal-category"
                value={category}
                onChange={handleCategoryChange}
                className="min-h-10 max-w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-gray-900"
              >
                <option value="">All categories ({deals.length})</option>
                {groups.map((group) => (
                  <option key={group.category} value={group.category}>
                    {group.category} ({group.deals.length})
                  </option>
                ))}
              </select>
            </div>
          )}
          {visibleGroups.map((group) => (
            <section key={group.category} className="mb-7 last:mb-0">
              <h2 className="mb-3 text-sm font-semibold text-gray-700">
                {group.category}{" "}
                <span className="ms-1 font-normal text-gray-500">· {group.deals.length}</span>
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.deals.map((deal) => (
                  <DealCard
                    key={deal.title}
                    deal={deal}
                    canCallTools={canCallTools}
                    canMessage={!!app}
                    onSearch={handleSearch}
                    onPlanMeal={handlePlanMeal}
                  />
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

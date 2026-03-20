import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ActionButton, Badge } from "../shared/components.js";
import { EmptyState, ErrorDisplay, Loading } from "../shared/status.js";
import type { DealData, WeeklyDealsContent } from "../shared/types.js";
import { useMcpView } from "../shared/use-mcp-view.js";

function DealCard({
  deal,
  onSearch,
}: {
  deal: DealData;
  onSearch: (title: string) => Promise<void>;
}) {
  const [searchState, setSearchState] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");

  const handleSearch = async () => {
    setSearchState("loading");
    try {
      await onSearch(deal.title);
      setSearchState("done");
      setTimeout(() => setSearchState("idle"), 2000);
    } catch {
      setSearchState("error");
      setTimeout(() => setSearchState("idle"), 2000);
    }
  };

  return (
    <div className="bg-white rounded-xl p-3.5 border border-gray-200/60 shadow-sm hover:shadow-md hover:border-gray-300/80 transition-all duration-200 dark:bg-gray-800/80 dark:border-gray-700/60 dark:hover:border-gray-600/80 flex flex-col">
      <div className="flex-1">
        <div className="font-semibold text-sm text-gray-900 dark:text-gray-100 leading-snug">
          {deal.title}
        </div>
        {deal.details && (
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
            {deal.details}
          </div>
        )}
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-base font-bold text-emerald-600 dark:text-emerald-400">
            {deal.price || "See ad"}
          </span>
          {deal.savings && (
            <span className="inline-flex items-center rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
              {deal.savings}
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/50">
        <ActionButton
          state={searchState}
          onClick={handleSearch}
          idleLabel="Search Product"
          loadingLabel="Searching..."
          doneLabel="Done!"
          failLabel="Failed"
          variant="secondary"
          icon={
            <svg
              aria-hidden="true"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
              />
            </svg>
          }
        />
      </div>
    </div>
  );
}

function WeeklyDealsView() {
  const { data, app, isConnected, error } = useMcpView<WeeklyDealsContent>(
    "weekly-deals",
    (sc) => !!sc?.deals,
  );

  if (error) return <ErrorDisplay message={error.message} />;
  if (!isConnected || !data) return <Loading />;

  const { deals, validFrom, validTill } = data;

  if (deals.length === 0) {
    return (
      <div className="p-4 max-w-4xl mx-auto">
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 tracking-tight mb-1">
          Weekly Deals
        </h1>
        <EmptyState
          icon={
            <svg
              aria-hidden="true"
              className="w-6 h-6"
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
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 6h.008v.008H6V6Z"
              />
            </svg>
          }
          message="No deals this week"
          description="Check back soon for weekly specials."
        />
      </div>
    );
  }

  const handleSearch = async (title: string) => {
    const result = await app?.callServerTool({
      name: "search_products",
      arguments: { terms: [title] },
    });
    if (result?.isError) {
      throw new Error("Failed to search product");
    }
  };

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="mb-5">
        <div className="flex items-center gap-2.5">
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 tracking-tight">
            Weekly Deals
          </h1>
          <Badge variant="green">{deals.length} deals</Badge>
        </div>
        {validFrom && validTill && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Valid {validFrom} &ndash; {validTill}
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {deals.map((deal) => (
          <DealCard key={deal.title} deal={deal} onSearch={handleSearch} />
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <WeeklyDealsView />,
);

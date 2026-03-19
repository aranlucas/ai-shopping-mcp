import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge } from "../shared/components.js";
import type { DealData, WeeklyDealsContent } from "../shared/types.js";

function DealCard({
  deal,
  onSearch,
}: {
  deal: DealData;
  onSearch: (title: string) => void;
}) {
  return (
    <div className="bg-white rounded-xl p-4 border border-gray-200/80 shadow-sm hover:shadow-md hover:border-gray-300/80 transition-all duration-200 dark:bg-gray-800 dark:border-gray-700/80 dark:hover:border-gray-600/80">
      <div className="font-semibold text-sm text-gray-900 dark:text-gray-100">
        {deal.title}
      </div>
      {deal.details && (
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {deal.details}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
          {deal.price || "See ad"}
        </span>
        {deal.savings && (
          <span className="inline-flex items-center rounded-md bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {deal.savings}
          </span>
        )}
      </div>
      <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg bg-gray-50 px-3.5 py-2 text-xs font-semibold text-gray-700 ring-1 ring-gray-200 hover:bg-gray-100 active:bg-gray-200 transition-colors dark:bg-gray-700 dark:text-gray-200 dark:ring-gray-600 dark:hover:bg-gray-600"
          onClick={() => onSearch(deal.title)}
        >
          <svg
            aria-hidden="true"
            className="w-3.5 h-3.5"
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
          Search Product
        </button>
      </div>
    </div>
  );
}

function WeeklyDealsView() {
  const [data, setData] = useState<WeeklyDealsContent | null>(null);

  const { app, isConnected, error } = useApp({
    appInfo: { name: "weekly-deals", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (appInstance) => {
      appInstance.ontoolresult = (result) => {
        const content = result.structuredContent as
          | WeeklyDealsContent
          | undefined;
        if (content?.deals) {
          setData(content);
        }
      };
      appInstance.onerror = console.error;
    },
  });

  useHostStyles(app, app?.getHostContext());

  if (error) {
    return (
      <div className="text-center py-12 text-gray-400 dark:text-gray-500">
        Error: {error.message}
      </div>
    );
  }
  if (!isConnected || !data) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400 dark:text-gray-500 gap-2">
        <svg
          aria-hidden="true"
          className="animate-spin h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        Loading...
      </div>
    );
  }

  const { deals, validFrom, validTill } = data;

  if (deals.length === 0) {
    return (
      <div className="p-4 max-w-4xl mx-auto">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6">
          Weekly Deals
        </h1>
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <svg
            aria-hidden="true"
            className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600"
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
          <p className="text-sm">No deals available this week.</p>
        </div>
      </div>
    );
  }

  const handleSearch = (title: string) => {
    app?.callServerTool({
      name: "search_products",
      arguments: { terms: [title] },
    });
  };

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          Weekly Deals
        </h1>
        <Badge variant="green">{deals.length} deals</Badge>
      </div>
      {validFrom && validTill && (
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
          Valid: {validFrom} &ndash; {validTill}
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

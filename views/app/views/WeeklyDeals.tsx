import type { App } from "@modelcontextprotocol/ext-apps/react";
import { useState } from "react";
import { ActionButton, Badge, SectionHeader } from "../../shared/components.js";
import { EmptyState } from "../../shared/status.js";
import { callTool, type DealData, type WeeklyDealsContent } from "../../shared/types.js";

function DealCard({
  deal,
  canCallTools,
  onSearch,
}: {
  deal: DealData;
  canCallTools: boolean;
  onSearch: (title: string) => Promise<void>;
}) {
  const [searchState, setSearchState] = useState<"idle" | "loading" | "done" | "error">("idle");

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
    <div className="bg-[var(--app-card-bg)] rounded-lg border border-[var(--app-border)] hover:border-[var(--app-border-hover)] hover:shadow-sm transition-all duration-150 p-3 flex flex-col">
      <div className="flex-1">
        <div className="font-medium text-[13px] text-gray-900 leading-snug">{deal.title}</div>
        {deal.details && (
          <div className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">{deal.details}</div>
        )}
        <div className="mt-2.5 flex items-baseline gap-2">
          <span className="text-xl font-semibold text-emerald-600 font-mono leading-none">
            {deal.price || "See ad"}
          </span>
          {deal.savings && <Badge variant="red">{deal.savings}</Badge>}
        </div>
      </div>
      <div className="mt-2.5 pt-2.5 border-t border-[var(--app-border)]">
        <ActionButton
          state={searchState}
          onClick={handleSearch}
          disabled={!canCallTools}
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

export function WeeklyDealsView({
  data,
  app,
  canCallTools,
}: {
  data: WeeklyDealsContent;
  app: App | null;
  canCallTools: boolean;
}) {
  const { deals, validFrom, validTill } = data;

  const handleSearch = async (title: string) => {
    const result = await callTool(app, {
      name: "search_products",
      arguments: { terms: [title] },
    });
    if (result?.isError) throw new Error("Failed to search product");
  };

  if (deals.length === 0) {
    return (
      <div className="px-3.5 py-3 max-w-4xl mx-auto animate-view-in">
        <h1 className="text-sm font-semibold text-gray-900 tracking-tight mb-1">Weekly Deals</h1>
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
                d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z"
              />
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6Z" />
            </svg>
          }
          message="No deals this week"
          description="Check back soon for weekly specials."
        />
      </div>
    );
  }

  return (
    <div className="px-3.5 py-3 max-w-4xl mx-auto animate-view-in">
      <SectionHeader
        title="Weekly Deals"
        badge={<span className="text-[11px] text-gray-400 font-mono">{deals.length} deals</span>}
        subtitle={validFrom && validTill ? `Valid ${validFrom} – ${validTill}` : undefined}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {deals.map((deal) => (
          <DealCard
            key={deal.title}
            deal={deal}
            canCallTools={canCallTools}
            onSearch={handleSearch}
          />
        ))}
      </div>
    </div>
  );
}

import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps/react";

import { useEffect, useState } from "react";

import { Badge } from "@agents/ui/components/badge";
import { Card, CardContent, CardFooter } from "@agents/ui/components/card";

import { ActionButton, DisplayModeToggle, SectionHeader } from "../../shared/components.js";
import { EmptyState } from "../../shared/status.js";
import {
  type DealData,
  type WeeklyDealsContent,
  callTool,
  sendUserMessage,
} from "../../shared/types.js";

function DealCard({
  deal,
  canCallTools,
  onSearch,
  onPlanMeal,
}: {
  deal: DealData;
  canCallTools: boolean;
  onSearch: (title: string) => Promise<void>;
  onPlanMeal: (title: string) => void;
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
    <Card size="sm" className="flex flex-col transition-shadow duration-150 hover:shadow-md">
      <CardContent className="flex-1 pt-3">
        <div className="text-sm leading-snug font-medium text-gray-900">{deal.title}</div>
        {deal.details && (
          <div className="mt-0.5 text-xs leading-relaxed text-gray-400">{deal.details}</div>
        )}
        <div className="mt-2.5 flex items-baseline gap-2">
          <span className="font-mono text-xl leading-none font-semibold text-emerald-600">
            {deal.price || "See ad"}
          </span>
          {deal.savings && (
            <Badge variant="outline" className="bg-red-50 text-red-600">
              {deal.savings}
            </Badge>
          )}
        </div>
      </CardContent>
      <CardFooter className="flex gap-1.5">
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
        <button
          type="button"
          onClick={() => onPlanMeal(deal.title)}
          className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-border bg-transparent px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-muted"
          title="Ask the assistant to plan a meal using this deal"
        >
          <svg
            aria-hidden="true"
            className="size-3"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"
            />
          </svg>
          Plan a meal
        </button>
      </CardFooter>
    </Card>
  );
}

/** Groups a category-sorted deals array into consecutive same-category runs. */
function groupDealsByCategory(deals: DealData[]): Array<{ category: string; deals: DealData[] }> {
  const groups: Array<{ category: string; deals: DealData[] }> = [];
  for (const deal of deals) {
    const last = groups[groups.length - 1];
    if (last && last.category === deal.category) {
      last.deals.push(deal);
    } else {
      groups.push({ category: deal.category, deals: [deal] });
    }
  }
  return groups;
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

  useEffect(() => {
    if (!app || deals.length === 0) return;
    app.updateModelContext({
      content: [
        {
          type: "text",
          text: `User is viewing ${deals.length} weekly deal${deals.length !== 1 ? "s" : ""}${validFrom ? ` valid ${validFrom} – ${validTill}` : ""}.`,
        },
      ],
      structuredContent: {
        event: "weekly_deals_viewed",
        count: deals.length,
        validFrom,
        validTill,
      },
    });
  }, [app, deals.length, validFrom, validTill]);

  const handleSearch = async (title: string) => {
    const result = await callTool(app, {
      name: "search_products",
      arguments: { terms: [title] },
    });
    if (result?.isError) throw new Error("Failed to search product");
  };

  const handlePlanMeal = (title: string) => {
    sendUserMessage(app, `Plan a quick meal that uses "${title}" from this week's deals.`);
  };

  if (deals.length === 0) {
    return (
      <div className="mx-auto max-w-4xl animate-in px-3.5 py-3 fade-in slide-in-from-bottom-1">
        <h1 className="mb-1 text-sm font-semibold tracking-tight text-gray-900">Weekly Deals</h1>
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
    <div className="mx-auto max-w-4xl animate-in px-3.5 py-3 fade-in slide-in-from-bottom-1">
      <SectionHeader
        title="Weekly Deals"
        badge={<span className="font-mono text-xs text-gray-400">{deals.length} deals</span>}
        subtitle={validFrom && validTill ? `Valid ${validFrom} – ${validTill}` : undefined}
        trailing={<DisplayModeToggle app={app} hostContext={hostContext} />}
      />
      {groupDealsByCategory(deals).map((group) => (
        <div key={group.category} className="mb-5 last:mb-0">
          <div className="mb-2.5 flex items-center gap-2">
            <span className="text-xs font-semibold tracking-wider text-gray-500 uppercase">
              {group.category}
            </span>
            <span className="text-xs text-gray-300">·</span>
            <span className="text-xs text-gray-400">
              {group.deals.length} item{group.deals.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {group.deals.map((deal) => (
              <DealCard
                key={deal.title}
                deal={deal}
                canCallTools={canCallTools}
                onSearch={handleSearch}
                onPlanMeal={handlePlanMeal}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

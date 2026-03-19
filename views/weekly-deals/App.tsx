import { useApp } from "@modelcontextprotocol/ext-apps/react";
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
    <div className="card">
      <div className="product-name">{deal.title}</div>
      {deal.details && <div className="product-size">{deal.details}</div>}
      <div style={{ marginTop: 6 }}>
        <span className="price">{deal.price || "See ad"}</span>
        {deal.savings && <span className="sale-badge">{deal.savings}</span>}
      </div>
      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => onSearch(deal.title)}
        >
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

  if (error) {
    return <div className="empty-state">Error: {error.message}</div>;
  }
  if (!isConnected || !data) {
    return <div id="loading">Loading...</div>;
  }

  const { deals, validFrom, validTill } = data;

  if (deals.length === 0) {
    return (
      <>
        <div className="header">Weekly Deals</div>
        <div className="empty-state">No deals available this week.</div>
      </>
    );
  }

  const handleSearch = (title: string) => {
    app?.callServerTool({
      name: "search_products",
      arguments: { terms: [title] },
    });
  };

  return (
    <>
      <div className="header">
        Weekly Deals <Badge variant="green">{deals.length} deals</Badge>
      </div>
      {validFrom && validTill && (
        <div className="subheader">
          Valid: {validFrom} - {validTill}
        </div>
      )}
      <div className="grid grid-2">
        {deals.map((deal) => (
          <DealCard key={deal.title} deal={deal} onSearch={handleSearch} />
        ))}
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<WeeklyDealsView />);

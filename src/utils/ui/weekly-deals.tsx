import { Badge, esc } from "./shared.js";

export interface DealData {
  title: string;
  details?: string;
  price?: string;
  savings?: string | null;
  validFrom?: string;
  validTill?: string;
}

function DealCard({ deal }: { deal: DealData }) {
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
          onClick={`searchProducts('${esc(deal.title)}')` as never}
        >
          Search Product
        </button>
      </div>
    </div>
  );
}

export function WeeklyDeals({
  deals,
  validFrom,
  validTill,
}: {
  deals: DealData[];
  validFrom?: string;
  validTill?: string;
}) {
  if (deals.length === 0) {
    return (
      <>
        <div className="header">Weekly Deals</div>
        <div className="empty-state">No deals available this week.</div>
      </>
    );
  }

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
          <DealCard key={deal.title} deal={deal} />
        ))}
      </div>
    </>
  );
}

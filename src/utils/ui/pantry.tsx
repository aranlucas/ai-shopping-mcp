import type { PantryItem } from "../user-storage.js";
import { Badge, esc } from "./shared.js";
import { Shell } from "./shell.js";

function ExpiryBadge({ expiresAt }: { expiresAt: string | undefined }) {
  if (!expiresAt) return null;
  const expiryDate = new Date(expiresAt);
  const daysUntil = Math.floor(
    (expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );

  if (daysUntil < 0) return <Badge variant="red">Expired</Badge>;
  if (daysUntil === 0) return <Badge variant="red">Expires Today</Badge>;
  if (daysUntil <= 3)
    return <Badge variant="yellow">Expires in {daysUntil}d</Badge>;
  return (
    <span className="meta-item">Exp: {expiryDate.toLocaleDateString()}</span>
  );
}

function PantryItemCard({ item }: { item: PantryItem }) {
  return (
    <div className="card">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <div className="product-name">{item.productName}</div>
          <div className="meta-row">
            <span className="meta-item">Qty: {item.quantity}</span>
            <ExpiryBadge expiresAt={item.expiresAt} />
          </div>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={
            `postAction({type:'tool',payload:{toolName:'manage_pantry',params:{action:'remove',productName:'${esc(item.productName)}'}}})` as never
          }
        >
          &#10005;
        </button>
      </div>
    </div>
  );
}

export function PantryList({
  items,
  actionDetail,
}: {
  items: PantryItem[];
  actionDetail?: string;
}) {
  if (items.length === 0) {
    return (
      <Shell>
        <div className="header">Pantry</div>
        <div className="empty-state">Your pantry is empty.</div>
      </Shell>
    );
  }

  const now = Date.now();
  const expiring = items.filter((i) => {
    if (!i.expiresAt) return false;
    const d = Math.floor(
      (new Date(i.expiresAt).getTime() - now) / (1000 * 60 * 60 * 24),
    );
    return d >= 0 && d <= 3;
  });

  return (
    <Shell>
      <div className="header">
        Pantry <Badge variant="blue">{items.length} items</Badge>
      </div>
      {actionDetail && <div className="subheader">{actionDetail}</div>}
      {expiring.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Badge variant="yellow">
            {expiring.length} item(s) expiring soon
          </Badge>
        </div>
      )}
      {items.map((item) => (
        <PantryItemCard key={item.productName} item={item} />
      ))}
    </Shell>
  );
}

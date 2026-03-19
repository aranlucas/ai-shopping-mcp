import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge } from "../shared/components.js";
import type { PantryItemData, PantryListContent } from "../shared/types.js";

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

function PantryItemCard({
  item,
  onRemove,
}: {
  item: PantryItemData;
  onRemove: (name: string) => void;
}) {
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
          onClick={() => onRemove(item.productName)}
        >
          &#10005;
        </button>
      </div>
    </div>
  );
}

function PantryView() {
  const [data, setData] = useState<PantryListContent | null>(null);

  const { app, isConnected, error } = useApp({
    appInfo: { name: "pantry", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (appInstance) => {
      appInstance.ontoolresult = (result) => {
        const content = result.structuredContent as
          | PantryListContent
          | undefined;
        if (content?.items) {
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

  const { items, actionDetail } = data;

  if (items.length === 0) {
    return (
      <>
        <div className="header">Pantry</div>
        <div className="empty-state">Your pantry is empty.</div>
      </>
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

  const handleRemove = (name: string) => {
    app?.callServerTool({
      name: "manage_pantry",
      arguments: { action: "remove", productName: name },
    });
  };

  return (
    <>
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
        <PantryItemCard
          key={item.productName}
          item={item}
          onRemove={handleRemove}
        />
      ))}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<PantryView />);

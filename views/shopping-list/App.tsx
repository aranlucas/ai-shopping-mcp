import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge } from "../shared/components.js";
import type {
  ShoppingListContent,
  ShoppingListItemData,
} from "../shared/types.js";

function ShoppingItem({
  item,
  onRemove,
}: {
  item: ShoppingListItemData;
  onRemove: (name: string) => void;
}) {
  const checkedStyle = item.checked
    ? ({ opacity: 0.5, textDecoration: "line-through" } as const)
    : undefined;

  return (
    <div className="card" style={checkedStyle}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <div className="product-name">
            {item.checked ? "\u2611" : "\u2610"} {item.productName}
          </div>
          <div className="meta-row">
            <span className="meta-item">Qty: {item.quantity}</span>
            {item.upc ? (
              <Badge variant="green">UPC</Badge>
            ) : (
              <Badge variant="yellow">Needs UPC</Badge>
            )}
            {item.upc && <span className="meta-item">UPC: {item.upc}</span>}
          </div>
          {item.notes && (
            <div
              className="meta-item"
              style={{ marginTop: 4, fontStyle: "italic" }}
            >
              {item.notes}
            </div>
          )}
        </div>
        {!item.checked && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onRemove(item.productName)}
          >
            &#10005;
          </button>
        )}
      </div>
    </div>
  );
}

function ShoppingListView() {
  const [data, setData] = useState<ShoppingListContent | null>(null);

  const { app, isConnected, error } = useApp({
    appInfo: { name: "shopping-list", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (appInstance) => {
      appInstance.ontoolresult = (result) => {
        const content = result.structuredContent as
          | ShoppingListContent
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

  const handleRemove = (name: string) => {
    app?.callServerTool({
      name: "manage_shopping_list",
      arguments: { action: "remove", productName: name },
    });
  };

  if (items.length === 0) {
    return (
      <>
        <div className="header">Shopping List</div>
        <div className="empty-state">
          <div style={{ fontSize: 32, marginBottom: 8 }}>&#128722;</div>
          <div>Your shopping list is empty</div>
        </div>
      </>
    );
  }

  const unchecked = items.filter((i) => !i.checked);
  const checked = items.filter((i) => i.checked);
  const withUpc = unchecked.filter((i) => i.upc);
  const withoutUpc = unchecked.filter((i) => !i.upc);

  return (
    <>
      <div className="header">Shopping List</div>
      {actionDetail && <div className="subheader">{actionDetail}</div>}
      <div
        style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}
      >
        <Badge variant="blue">{unchecked.length} to buy</Badge>
        <Badge variant="green">{withUpc.length} ready for checkout</Badge>
        {withoutUpc.length > 0 && (
          <Badge variant="yellow">{withoutUpc.length} need UPC</Badge>
        )}
        {checked.length > 0 && (
          <Badge variant="gray">{checked.length} in cart</Badge>
        )}
      </div>

      {unchecked.map((item) => (
        <ShoppingItem
          key={item.productName}
          item={item}
          onRemove={handleRemove}
        />
      ))}

      {checked.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 600, color: "#6b7280", marginBottom: 8 }}>
            In Cart ({checked.length})
          </div>
          {checked.map((item) => (
            <ShoppingItem
              key={item.productName}
              item={item}
              onRemove={handleRemove}
            />
          ))}
        </div>
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<ShoppingListView />);

import type { ShoppingListItem } from "../user-storage.js";
import { Badge, esc } from "./shared.js";
import { Shell } from "./shell.js";

function ShoppingItem({ item }: { item: ShoppingListItem }) {
  const checkedStyle = item.checked
    ? { opacity: 0.5, textDecoration: "line-through" as const }
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
            onClick={
              `toolCall('manage_shopping_list',{action:'remove',productName:'${esc(item.productName)}'})` as never
            }
          >
            &#10005;
          </button>
        )}
      </div>
    </div>
  );
}

export function ShoppingList({
  items,
  actionDetail,
}: {
  items: ShoppingListItem[];
  actionDetail?: string;
}) {
  if (items.length === 0) {
    return (
      <Shell>
        <div className="header">Shopping List</div>
        <div className="empty-state">
          <div style={{ fontSize: 32, marginBottom: 8 }}>&#128722;</div>
          <div>Your shopping list is empty</div>
        </div>
      </Shell>
    );
  }

  const unchecked = items.filter((i) => !i.checked);
  const checked = items.filter((i) => i.checked);
  const withUpc = unchecked.filter((i) => i.upc);
  const withoutUpc = unchecked.filter((i) => !i.upc);

  return (
    <Shell>
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
        <ShoppingItem key={item.productName} item={item} />
      ))}

      {checked.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 600, color: "#6b7280", marginBottom: 8 }}>
            In Cart ({checked.length})
          </div>
          {checked.map((item) => (
            <ShoppingItem key={item.productName} item={item} />
          ))}
        </div>
      )}
    </Shell>
  );
}

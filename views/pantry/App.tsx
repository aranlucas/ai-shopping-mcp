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
    <span className="text-xs text-gray-400">
      Exp: {expiryDate.toLocaleDateString()}
    </span>
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
    <div className="bg-white rounded-xl p-4 border border-gray-200/80 shadow-sm hover:shadow-md hover:border-gray-300/80 transition-all duration-200">
      <div className="flex justify-between items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-gray-900">
            {item.productName}
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-xs text-gray-500">Qty: {item.quantity}</span>
            <ExpiryBadge expiresAt={item.expiresAt} />
          </div>
        </div>
        <button
          type="button"
          className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
          onClick={() => onRemove(item.productName)}
        >
          <svg
            aria-hidden="true"
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18 18 6M6 6l12 12"
            />
          </svg>
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
    return (
      <div className="text-center py-12 text-gray-400">
        Error: {error.message}
      </div>
    );
  }
  if (!isConnected || !data) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400 gap-2">
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

  const { items, actionDetail } = data;

  if (items.length === 0) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <h1 className="text-xl font-bold text-gray-900 mb-6">Pantry</h1>
        <div className="text-center py-16 text-gray-400">
          <svg
            aria-hidden="true"
            className="w-12 h-12 mx-auto mb-3 text-gray-300"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z"
            />
          </svg>
          <p className="text-sm">Your pantry is empty.</p>
        </div>
      </div>
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
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-xl font-bold text-gray-900">Pantry</h1>
        <Badge variant="blue">{items.length} items</Badge>
      </div>
      {actionDetail && (
        <p className="text-sm text-gray-500 mt-1">{actionDetail}</p>
      )}

      {expiring.length > 0 && (
        <div className="mt-3 mb-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-2">
          <svg
            aria-hidden="true"
            className="w-4 h-4 text-amber-500 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
          <span className="text-sm font-medium text-amber-700">
            {expiring.length} item(s) expiring soon
          </span>
        </div>
      )}

      <div className="space-y-2 mt-4">
        {items.map((item) => (
          <PantryItemCard
            key={item.productName}
            item={item}
            onRemove={handleRemove}
          />
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <PantryView />,
);

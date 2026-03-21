import type { App } from "@modelcontextprotocol/ext-apps/react";
import { useState } from "react";
import { ActionButton, Badge, SectionHeader } from "../../shared/components.js";
import { EmptyState } from "../../shared/status.js";
import {
  callTool,
  type PantryItemData,
  type PantryListContent,
} from "../../shared/types.js";

function ExpiryBadge({ expiresAt }: { expiresAt: string | undefined }) {
  if (!expiresAt) return null;
  const expiryDate = new Date(expiresAt);
  const daysUntil = Math.floor(
    (expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );
  if (daysUntil < 0) return <Badge variant="red">Expired</Badge>;
  if (daysUntil === 0) return <Badge variant="red">Today</Badge>;
  if (daysUntil <= 3) return <Badge variant="yellow">{daysUntil}d left</Badge>;
  return (
    <span className="text-xs text-gray-400">
      Exp{" "}
      {expiryDate.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })}
    </span>
  );
}

function PantryItemRow({
  item,
  canCallTools,
  onRemove,
}: {
  item: PantryItemData;
  canCallTools: boolean;
  onRemove: (name: string) => Promise<void>;
}) {
  const [removeState, setRemoveState] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");

  const handleRemove = async () => {
    setRemoveState("loading");
    try {
      await onRemove(item.productName);
      setRemoveState("done");
    } catch {
      setRemoveState("error");
      setTimeout(() => setRemoveState("idle"), 2000);
    }
  };

  const isExpiring = (() => {
    if (!item.expiresAt) return false;
    const d = Math.floor(
      (new Date(item.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );
    return d >= 0 && d <= 3;
  })();

  return (
    <div
      className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl border transition-all duration-150 ${removeState !== "idle" ? "opacity-40" : ""} ${isExpiring ? "bg-amber-50/50 border-amber-200/60" : "bg-white border-gray-200/60 shadow-sm"}`}
    >
      <div className="shrink-0 w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center">
        <svg
          aria-hidden="true"
          className="w-3.5 h-3.5 text-gray-500"
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
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 truncate">
          {item.productName}
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-xs text-gray-400">&times;{item.quantity}</span>
          <ExpiryBadge expiresAt={item.expiresAt} />
        </div>
      </div>
      <ActionButton
        state={removeState}
        onClick={handleRemove}
        disabled={!canCallTools}
        idleLabel=""
        loadingLabel=""
        doneLabel=""
        failLabel=""
        variant="secondary"
        icon={
          <svg
            aria-label="Remove"
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18 18 6M6 6l12 12"
            />
          </svg>
        }
      />
    </div>
  );
}

export function PantryView({
  data,
  setData,
  app,
  canCallTools,
}: {
  data: PantryListContent;
  setData: (data: unknown) => void;
  app: App | null;
  canCallTools: boolean;
}) {
  const { items, actionDetail } = data;

  const handleRemove = async (name: string) => {
    const result = await callTool(app, {
      name: "manage_pantry",
      arguments: { action: "remove", productName: name },
    });
    if (result?.isError) throw new Error("Failed to remove item");
    const updated = result?.structuredContent as PantryListContent | undefined;
    if (updated?.items) setData(updated);
  };

  if (items.length === 0) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <h1 className="text-lg font-bold text-gray-900 tracking-tight mb-1">
          Pantry
        </h1>
        <EmptyState
          icon={
            <svg
              aria-hidden="true"
              className="w-6 h-6"
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
          }
          message="Your pantry is empty"
          description="Add items to track what you have at home."
        />
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

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <SectionHeader
        title="Pantry"
        badge={<Badge variant="blue">{items.length} items</Badge>}
        subtitle={actionDetail}
      />
      {expiring.length > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200/60 rounded-xl px-3.5 py-2.5 flex items-center gap-2.5">
          <svg
            aria-hidden="true"
            className="w-4 h-4 text-amber-500 shrink-0"
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
            {expiring.length} item{expiring.length !== 1 ? "s" : ""} expiring
            soon
          </span>
        </div>
      )}
      <div className="space-y-1.5">
        {items.map((item) => (
          <PantryItemRow
            key={item.productName}
            item={item}
            canCallTools={canCallTools}
            onRemove={handleRemove}
          />
        ))}
      </div>
    </div>
  );
}

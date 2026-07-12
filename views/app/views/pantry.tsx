import type { App } from "@modelcontextprotocol/ext-apps/react";

import { useState } from "react";

import { Badge } from "@/shared/ui/badge.js";
import { Separator } from "@/shared/ui/separator.js";

import { ActionButton, SectionHeader } from "../../shared/components.js";
import { EmptyState } from "../../shared/status.js";
import {
  type AppData,
  type PantryItemData,
  type PantryListContent,
  callTool,
  parseToolResult,
  sendUserMessage,
} from "../../shared/types.js";

function ExpiryBadge({ expiresAt }: { expiresAt: string | undefined }) {
  if (!expiresAt) return null;
  const expiryDate = new Date(expiresAt);
  const daysUntil = Math.floor((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (daysUntil < 0) return <Badge variant="red">Expired</Badge>;
  if (daysUntil === 0) return <Badge variant="red">Today</Badge>;
  if (daysUntil <= 3) return <Badge variant="yellow">{daysUntil}d left</Badge>;
  return (
    <span className="text-[11px] text-gray-400">
      Exp {expiryDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
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
  const [removeState, setRemoveState] = useState<"idle" | "loading" | "done" | "error">("idle");

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

  const isExpiringSoon = (() => {
    if (!item.expiresAt) return false;
    const d = Math.floor((new Date(item.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return d >= 0 && d <= 3;
  })();

  return (
    <div
      className={`flex items-center gap-2.5 py-2.5 transition-opacity duration-150 ${removeState !== "idle" ? "opacity-40" : ""}`}
    >
      {/* Icon */}
      <div
        className={`shrink-0 w-6 h-6 rounded flex items-center justify-center ${isExpiringSoon ? "bg-amber-50 text-amber-500" : "bg-gray-100 text-gray-400"}`}
      >
        <svg
          aria-hidden="true"
          className="w-3.5 h-3.5"
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

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-gray-900 truncate">{item.productName}</div>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <span className="text-[11px] text-gray-400 font-mono">×{item.quantity}</span>
          <ExpiryBadge expiresAt={item.expiresAt} />
        </div>
      </div>

      {/* Remove */}
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
            className="w-3 h-3"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2.5}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
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
  setData: (data: AppData | null) => void;
  app: App | null;
  canCallTools: boolean;
}) {
  const { items, actionDetail } = data;

  const handleRemove = async (name: string) => {
    const result = await callTool(app, {
      name: "remove_from_inventory",
      arguments: { inventory: "pantry", items: [{ name }] },
    });
    if (result?.isError) throw new Error("Failed to remove item");
    const updated = parseToolResult(result);
    if (updated) setData(updated);
  };

  if (items.length === 0) {
    return (
      <div className="px-3.5 py-3 max-w-2xl mx-auto animate-view-in">
        <h1 className="text-sm font-semibold text-gray-900 tracking-tight mb-1">Pantry</h1>
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
    const d = Math.floor((new Date(i.expiresAt).getTime() - now) / (1000 * 60 * 60 * 24));
    return d >= 0 && d <= 3;
  });
  const nonExpiring = items.filter((i) => !expiring.includes(i));

  const handleSuggestRecipes = () => {
    const focus = expiring.length > 0 ? " Prioritize what's expiring soon." : "";
    sendUserMessage(
      app,
      `Suggest a few recipes I can make from what's currently in my pantry.${focus}`,
    );
  };

  return (
    <div className="px-3.5 py-3 max-w-2xl mx-auto animate-view-in">
      <SectionHeader
        title="Pantry"
        badge={<span className="text-[11px] text-gray-400 font-mono">{items.length} items</span>}
        subtitle={actionDetail}
      />

      {items.length >= 3 && (
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            onClick={handleSuggestRecipes}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--app-accent-text)] px-3 py-1 text-[11px] font-medium text-[var(--app-accent-text)] hover:bg-[var(--app-accent-text)]/5 transition-colors bg-transparent cursor-pointer"
          >
            <svg
              aria-hidden="true"
              className="w-3 h-3"
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
            Suggest recipes from pantry
          </button>
        </div>
      )}

      {/* Expiring items pinned at top */}
      {expiring.length > 0 && (
        <>
          <div className="mb-1 flex items-center gap-2">
            <svg
              aria-hidden="true"
              className="w-3.5 h-3.5 text-amber-500 shrink-0"
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
            <span className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider">
              Use soon · {expiring.length}
            </span>
          </div>
          <div className="divide-y divide-border">
            {expiring.map((item) => (
              <PantryItemRow
                key={item.productName}
                item={item}
                canCallTools={canCallTools}
                onRemove={handleRemove}
              />
            ))}
          </div>
          {nonExpiring.length > 0 && <Separator className="my-3" />}
        </>
      )}

      {/* Rest of pantry */}
      {nonExpiring.length > 0 && (
        <div className="divide-y divide-border">
          {nonExpiring.map((item) => (
            <PantryItemRow
              key={item.productName}
              item={item}
              canCallTools={canCallTools}
              onRemove={handleRemove}
            />
          ))}
        </div>
      )}
    </div>
  );
}

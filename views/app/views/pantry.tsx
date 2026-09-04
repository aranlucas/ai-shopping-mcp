import type { App } from "@modelcontextprotocol/ext-apps/react";

import { useCallback, useMemo, useState } from "react";

import { Badge } from "@agents/ui/components/badge";
import { Separator } from "@agents/ui/components/separator";

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

const REMOVE_ICON = (
  <svg
    aria-label="Remove"
    className="size-3"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2.5}
    stroke="currentColor"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
  </svg>
);

const EMPTY_PANTRY_ICON = (
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
      d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z"
    />
  </svg>
);

function ExpiryBadge({ expiresAt, now }: { expiresAt: string | undefined; now: number }) {
  const expiryDate = useMemo(() => (expiresAt ? new Date(expiresAt) : null), [expiresAt]);
  if (!expiresAt || !expiryDate) return null;
  const daysUntil = Math.floor((expiryDate.getTime() - now) / (1000 * 60 * 60 * 24));
  const expiryLabel = useMemo(
    () => expiryDate.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    [expiryDate],
  );
  const soonLabel = useMemo(() => `${daysUntil}d left`, [daysUntil]);
  if (daysUntil < 0)
    return (
      <Badge variant="outline" className="bg-red-50 text-red-600">
        Expired
      </Badge>
    );
  if (daysUntil === 0)
    return (
      <Badge variant="outline" className="bg-red-50 text-red-600">
        Today
      </Badge>
    );
  if (daysUntil <= 3)
    return (
      <Badge variant="outline" className="bg-amber-50 text-amber-700">
        {soonLabel}
      </Badge>
    );
  return <span className="text-xs text-gray-400">Exp {expiryLabel}</span>;
}

function PantryItemRow({
  item,
  canCallTools,
  onRemove,
  now,
}: {
  item: PantryItemData;
  canCallTools: boolean;
  onRemove: (name: string) => Promise<void>;
  now: number;
}) {
  const [removeState, setRemoveState] = useState<"idle" | "loading" | "done" | "error">("idle");

  const handleRemove = useCallback(async () => {
    setRemoveState("loading");
    try {
      await onRemove(item.productName);
      setRemoveState("done");
    } catch {
      setRemoveState("error");
      setTimeout(() => setRemoveState("idle"), 2000);
    }
  }, [item.productName, onRemove]);

  const isExpiringSoon = useMemo(() => {
    if (!item.expiresAt) return false;
    const d = Math.floor((new Date(item.expiresAt).getTime() - now) / (1000 * 60 * 60 * 24));
    return d >= 0 && d <= 3;
  }, [item.expiresAt, now]);

  return (
    <div
      className={`flex items-center gap-2.5 py-2.5 transition-opacity duration-150 ${removeState !== "idle" ? "opacity-40" : ""}`}
    >
      {/* Icon */}
      <div
        className={`flex size-6 shrink-0 items-center justify-center rounded ${isExpiringSoon ? "bg-amber-50 text-amber-500" : "bg-gray-100 text-gray-400"}`}
      >
        <svg
          aria-hidden="true"
          className="size-3.5"
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
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-gray-900">{item.productName}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-xs text-gray-400">×{item.quantity}</span>
          <ExpiryBadge expiresAt={item.expiresAt} now={now} />
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
        icon={REMOVE_ICON}
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
  const [now] = useState(() => Date.now());

  const expiring = useMemo(
    () =>
      items.filter((i) => {
        if (!i.expiresAt) return false;
        const d = Math.floor((new Date(i.expiresAt).getTime() - now) / (1000 * 60 * 60 * 24));
        return d >= 0 && d <= 3;
      }),
    [items, now],
  );
  const nonExpiring = useMemo(() => items.filter((i) => !expiring.includes(i)), [items, expiring]);

  const handleRemove = useCallback(
    async (name: string) => {
      const result = await callTool(app, {
        name: "remove_from_inventory",
        arguments: { inventory: "pantry", items: [{ name }] },
      });
      if (result?.isError) throw new Error("Failed to remove item");
      const updated = parseToolResult(result);
      if (updated) setData(updated);
    },
    [app, setData],
  );

  const handleSuggestRecipes = useCallback(() => {
    const focus = expiring.length > 0 ? " Prioritize what's expiring soon." : "";
    sendUserMessage(
      app,
      `Suggest a few recipes I can make from what's currently in my pantry.${focus}`,
    );
  }, [app, expiring.length]);

  const headerBadge = useMemo(
    () => <span className="font-mono text-xs text-gray-400">{items.length} items</span>,
    [items.length],
  );

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl animate-in px-3.5 py-3 fade-in slide-in-from-bottom-1">
        <h1 className="mb-1 text-sm font-semibold tracking-tight text-gray-900">Pantry</h1>
        <EmptyState
          icon={EMPTY_PANTRY_ICON}
          message="Your pantry is empty"
          description="Add items to track what you have at home."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl animate-in px-3.5 py-3 fade-in slide-in-from-bottom-1">
      <SectionHeader title="Pantry" badge={headerBadge} subtitle={actionDetail} />

      {items.length >= 3 && (
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            onClick={handleSuggestRecipes}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-primary bg-transparent px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/5"
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
              className="size-3.5 shrink-0 text-amber-500"
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
            <span className="text-xs font-semibold tracking-wider text-amber-700 uppercase">
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
                now={now}
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
              now={now}
            />
          ))}
        </div>
      )}
    </div>
  );
}

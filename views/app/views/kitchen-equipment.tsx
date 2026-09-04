import type { App } from "@modelcontextprotocol/ext-apps/react";

import { useState } from "react";

import { Badge } from "@agents/ui/components/badge";

import { ActionButton, SectionHeader } from "../../shared/components.js";
import { EmptyState } from "../../shared/status.js";
import {
  type AppData,
  type KitchenEquipmentContent,
  type KitchenEquipmentItemData,
  callTool,
  parseToolResult,
} from "../../shared/types.js";

function KitchenEquipmentRow({
  item,
  canCallTools,
  onRemove,
}: {
  item: KitchenEquipmentItemData;
  canCallTools: boolean;
  onRemove: (name: string) => Promise<void>;
}) {
  const [removeState, setRemoveState] = useState<"idle" | "loading" | "done" | "error">("idle");

  const handleRemove = async () => {
    setRemoveState("loading");
    try {
      await onRemove(item.equipmentName);
      setRemoveState("done");
    } catch {
      setRemoveState("error");
      setTimeout(() => setRemoveState("idle"), 2000);
    }
  };

  return (
    <div
      className={`flex items-center gap-2.5 py-2.5 transition-opacity duration-150 ${removeState !== "idle" ? "opacity-40" : ""}`}
    >
      <div className="flex size-6 shrink-0 items-center justify-center rounded bg-gray-100 text-gray-400">
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
            d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.88-5.88m-3.7 3.8L8.25 12m0 0 2.17-2.17m-2.17 2.17-5.88-5.88A2.652 2.652 0 0 1 6.12 2.37L12 8.25m-1.58 1.58 3.75-3.75M3 21l3.75-3.75"
          />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-gray-900">{item.equipmentName}</div>
        {item.category && (
          <div className="mt-0.5">
            <Badge variant="secondary" className="bg-gray-100 text-gray-500">
              {item.category}
            </Badge>
          </div>
        )}
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
            className="size-3"
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

export function KitchenEquipmentView({
  data,
  setData,
  app,
  canCallTools,
}: {
  data: KitchenEquipmentContent;
  setData: (data: AppData | null) => void;
  app: App | null;
  canCallTools: boolean;
}) {
  const { items, actionDetail } = data;

  const handleRemove = async (name: string) => {
    const result = await callTool(app, {
      name: "remove_from_inventory",
      arguments: { inventory: "equipment", items: [{ name }] },
    });
    if (result?.isError) throw new Error("Failed to remove equipment");
    const updated = parseToolResult(result);
    if (updated) setData(updated);
  };

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl animate-in px-3.5 py-3 fade-in slide-in-from-bottom-1">
        <h1 className="mb-1 text-sm font-semibold tracking-tight text-gray-900">
          Kitchen Equipment
        </h1>
        <EmptyState
          icon={
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
                d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.88-5.88m-3.7 3.8L8.25 12m0 0 2.17-2.17m-2.17 2.17-5.88-5.88A2.652 2.652 0 0 1 6.12 2.37L12 8.25m-1.58 1.58 3.75-3.75M3 21l3.75-3.75"
              />
            </svg>
          }
          message="No kitchen equipment saved"
          description="Add tools and appliances to improve meal suggestions."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl animate-in px-3.5 py-3 fade-in slide-in-from-bottom-1">
      <SectionHeader
        title="Kitchen Equipment"
        badge={<span className="font-mono text-xs text-gray-400">{items.length} items</span>}
        subtitle={actionDetail}
      />
      <div className="divide-y divide-border">
        {items.map((item) => (
          <KitchenEquipmentRow
            key={item.equipmentName}
            item={item}
            canCallTools={canCallTools}
            onRemove={handleRemove}
          />
        ))}
      </div>
    </div>
  );
}

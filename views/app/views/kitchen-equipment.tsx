import type { App } from "@modelcontextprotocol/ext-apps/react";

import { useState } from "react";

import { Badge } from "@/shared/ui/badge.js";

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
      <div className="shrink-0 w-6 h-6 rounded bg-gray-100 flex items-center justify-center text-gray-400">
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
            d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.88-5.88m-3.7 3.8L8.25 12m0 0 2.17-2.17m-2.17 2.17-5.88-5.88A2.652 2.652 0 0 1 6.12 2.37L12 8.25m-1.58 1.58 3.75-3.75M3 21l3.75-3.75"
          />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-gray-900 truncate">{item.equipmentName}</div>
        {item.category && (
          <div className="mt-0.5">
            <Badge variant="gray">{item.category}</Badge>
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
      <div className="px-3.5 py-3 max-w-2xl mx-auto animate-view-in">
        <h1 className="text-sm font-semibold text-gray-900 tracking-tight mb-1">
          Kitchen Equipment
        </h1>
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
    <div className="px-3.5 py-3 max-w-2xl mx-auto animate-view-in">
      <SectionHeader
        title="Kitchen Equipment"
        badge={<span className="text-[11px] text-gray-400 font-mono">{items.length} items</span>}
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

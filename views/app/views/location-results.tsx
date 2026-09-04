import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps/react";

import { useCallback, useMemo, useState } from "react";

import { ActionButton, Badge, DisplayModeToggle, SectionHeader } from "../../shared/components.js";
import { EmptyState } from "../../shared/status.js";
import {
  type AppData,
  type LocationData,
  type StoreResultsContent,
  callTool,
  openExternalLink,
  parseToolResult,
} from "../../shared/types.js";

const EMPTY_LOCATIONS_ICON = (
  <svg
    aria-hidden="true"
    className="size-5"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"
    />
  </svg>
);

const PREFERRED_STAR_ICON = (
  <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z"
    />
  </svg>
);

function locationToMapsUrl(loc: LocationData): string | null {
  const a = loc.address;
  if (!a?.addressLine1) return null;
  const parts = [a.addressLine1, a.city, a.state, a.zipCode].filter(Boolean).join(", ");
  return `https://maps.google.com/?q=${encodeURIComponent(parts)}`;
}

function LocationCard({
  location,
  canCallTools,
  app,
  onSetPreferred,
  onViewDetails,
}: {
  location: LocationData;
  canCallTools: boolean;
  app: App | null;
  onSetPreferred: (id: string) => Promise<void>;
  onViewDetails: (id: string) => Promise<void>;
}) {
  const id = location.locationId || "";
  const [prefState, setPrefState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [detailState, setDetailState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const mapsUrl = locationToMapsUrl(location);

  const handleSetPreferred = useCallback(async () => {
    setPrefState("loading");
    try {
      await onSetPreferred(id);
      setPrefState("done");
    } catch {
      setPrefState("error");
      setTimeout(() => setPrefState("idle"), 2000);
    }
  }, [id, onSetPreferred]);

  const handleViewDetails = useCallback(async () => {
    setDetailState("loading");
    try {
      await onViewDetails(id);
      setDetailState("idle");
    } catch {
      setDetailState("error");
      setTimeout(() => setDetailState("idle"), 2000);
    }
  }, [id, onViewDetails]);

  const handleOpenMaps = useCallback(() => {
    if (mapsUrl) {
      void openExternalLink(app, mapsUrl);
    }
  }, [app, mapsUrl]);

  return (
    <div className="rounded-lg border border-border bg-card p-3 transition-all duration-150 hover:border-primary/20 hover:shadow-sm">
      {/* Header */}
      <div className="mb-2 flex items-start gap-2">
        <div className="flex size-7 shrink-0 items-center justify-center rounded bg-gray-100 text-gray-500">
          <svg
            aria-hidden="true"
            className="size-4"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M13.5 21v-7.5a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 .75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349M3.75 21V9.349m0 0a3.001 3.001 0 0 0 3.75-.615A2.993 2.993 0 0 0 9.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 0 0 2.25 1.016c.896 0 1.7-.393 2.25-1.015a3.001 3.001 0 0 0 3.75.614m-16.5 0a3.004 3.004 0 0 1-.621-4.72l1.189-1.19A1.5 1.5 0 0 1 5.378 3h13.243a1.5 1.5 0 0 1 1.06.44l1.19 1.189a3 3 0 0 1-.621 4.72M6.75 18h3.75a.75.75 0 0 0 .75-.75V13.5a.75.75 0 0 0-.75-.75H6.75a.75.75 0 0 0-.75.75v3.75c0 .414.336.75.75.75Z"
            />
          </svg>
        </div>
        <div className="min-w-0">
          <div className="text-sm leading-snug font-medium text-gray-900">
            {location.name || "Unknown Store"}
          </div>
          {location.chain && (
            <div className="mt-0.5">
              <Badge variant="secondary" className="bg-gray-100 text-gray-500">
                {location.chain}
              </Badge>
            </div>
          )}
        </div>
      </div>

      {/* Address */}
      {location.address && (
        <div className="mb-1 flex items-start gap-1 text-xs text-gray-500">
          <svg
            aria-hidden="true"
            className="mt-0.5 size-3 shrink-0 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"
            />
          </svg>
          <span className="min-w-0 flex-1">
            {location.address.addressLine1}, {location.address.city}, {location.address.state}{" "}
            {location.address.zipCode}
          </span>
          {mapsUrl && (
            <button
              type="button"
              onClick={handleOpenMaps}
              title="Open in Maps"
              aria-label="Open in Maps"
              className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-primary hover:opacity-80"
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
                  d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                />
              </svg>
            </button>
          )}
        </div>
      )}
      {location.phone && (
        <div className="mb-1.5 flex items-center gap-1 text-xs text-gray-500">
          <svg
            aria-hidden="true"
            className="size-3 shrink-0 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z"
            />
          </svg>
          {location.phone}
        </div>
      )}
      <div className="mb-2.5 font-mono text-xs text-gray-300">{id}</div>

      {/* Actions */}
      <div className="flex gap-1.5 border-t border-border pt-2.5">
        <ActionButton
          state={prefState}
          onClick={handleSetPreferred}
          disabled={!canCallTools || prefState === "done"}
          idleLabel="Set Preferred"
          loadingLabel="Saving..."
          doneLabel="Preferred!"
          failLabel="Failed"
          variant="primary"
          icon={PREFERRED_STAR_ICON}
        />
        <ActionButton
          state={detailState}
          onClick={handleViewDetails}
          disabled={!canCallTools}
          idleLabel="Details"
          loadingLabel="Loading..."
          doneLabel="Done"
          failLabel="Failed"
          variant="secondary"
        />
      </div>
    </div>
  );
}

export function LocationResultsView({
  data,
  setData,
  app,
  canCallTools,
  hostContext,
}: {
  data: StoreResultsContent;
  setData: (data: AppData | null) => void;
  app: App | null;
  canCallTools: boolean;
  hostContext?: McpUiHostContext;
}) {
  const { stores } = data;

  const handleSetPreferred = useCallback(
    async (id: string) => {
      const result = await callTool(app, {
        name: "set_preferred_store",
        arguments: { storeId: id },
      });
      if (result?.isError) throw new Error("Failed to set preferred location");
    },
    [app],
  );

  const handleViewDetails = useCallback(
    async (id: string) => {
      const result = await callTool(app, {
        name: "get_store",
        arguments: { storeId: id },
      });
      if (result?.isError) throw new Error("Failed to load details");
      const parsed = parseToolResult(result);
      if (parsed) setData(parsed);
    },
    [app, setData],
  );

  const headerBadge = useMemo(
    () => <span className="font-mono text-xs text-gray-400">{stores.length} found</span>,
    [stores.length],
  );
  const headerTrailing = useMemo(
    () => <DisplayModeToggle app={app} hostContext={hostContext} />,
    [app, hostContext],
  );

  if (stores.length === 0) {
    return (
      <div className="mx-auto max-w-4xl animate-in px-3.5 py-3 fade-in slide-in-from-bottom-1">
        <h1 className="mb-1 text-sm font-semibold tracking-tight text-gray-900">Store Locations</h1>
        <EmptyState
          icon={EMPTY_LOCATIONS_ICON}
          message="No locations found"
          description="Try a different zip code or chain name."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl animate-in px-3.5 py-3 fade-in slide-in-from-bottom-1">
      <SectionHeader title="Store Locations" badge={headerBadge} trailing={headerTrailing} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {stores.map((loc) => (
          <LocationCard
            key={loc.locationId}
            location={loc}
            canCallTools={canCallTools}
            app={app}
            onSetPreferred={handleSetPreferred}
            onViewDetails={handleViewDetails}
          />
        ))}
      </div>
    </div>
  );
}

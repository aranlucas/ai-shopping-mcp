import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ActionButton, Badge } from "../shared/components.js";
import { EmptyState, ErrorDisplay, Loading } from "../shared/status.js";
import type { LocationData, LocationResultsContent } from "../shared/types.js";
import { useMcpView } from "../shared/use-mcp-view.js";

function LocationCard({
  location,
  onSetPreferred,
  onViewDetails,
}: {
  location: LocationData;
  onSetPreferred: (id: string) => Promise<void>;
  onViewDetails: (id: string) => Promise<void>;
}) {
  const id = location.locationId || "";
  const [prefState, setPrefState] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [detailState, setDetailState] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");

  const handleSetPreferred = async () => {
    setPrefState("loading");
    try {
      await onSetPreferred(id);
      setPrefState("done");
    } catch {
      setPrefState("error");
      setTimeout(() => setPrefState("idle"), 2000);
    }
  };

  const handleViewDetails = async () => {
    setDetailState("loading");
    try {
      await onViewDetails(id);
      setDetailState("idle");
    } catch {
      setDetailState("error");
      setTimeout(() => setDetailState("idle"), 2000);
    }
  };

  return (
    <div className="bg-white rounded-xl p-3.5 border border-gray-200/60 shadow-sm hover:shadow-md hover:border-gray-300/80 transition-all duration-200 dark:bg-gray-800/80 dark:border-gray-700/60 dark:hover:border-gray-600/80">
      {/* Store header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <div className="font-semibold text-sm text-gray-900 dark:text-gray-100 leading-snug">
            {location.name || "Unknown Store"}
          </div>
          {location.chain && (
            <div className="mt-1">
              <Badge variant="blue">{location.chain}</Badge>
            </div>
          )}
        </div>
        <div className="shrink-0 w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center">
          <svg
            aria-hidden="true"
            className="w-4 h-4 text-blue-500 dark:text-blue-400"
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
      </div>

      {/* Address */}
      {location.address && (
        <div className="text-xs text-gray-500 dark:text-gray-400 flex items-start gap-1.5 mb-1.5">
          <svg
            aria-hidden="true"
            className="w-3 h-3 text-gray-400 dark:text-gray-500 mt-0.5 shrink-0"
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
          <span>
            {location.address.addressLine1}, {location.address.city},{" "}
            {location.address.state} {location.address.zipCode}
          </span>
        </div>
      )}

      {/* Phone */}
      {location.phone && (
        <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5 mb-2">
          <svg
            aria-hidden="true"
            className="w-3 h-3 text-gray-400 dark:text-gray-500 shrink-0"
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

      <div className="text-[10px] text-gray-300 dark:text-gray-600 font-mono mb-3">
        ID: {id}
      </div>

      <div className="flex gap-2 pt-3 border-t border-gray-100 dark:border-gray-700/50">
        <ActionButton
          state={prefState}
          onClick={handleSetPreferred}
          disabled={prefState === "done"}
          idleLabel="Set Preferred"
          loadingLabel="Saving..."
          doneLabel="Preferred!"
          failLabel="Failed"
          variant="primary"
          icon={
            <svg
              aria-hidden="true"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z"
              />
            </svg>
          }
        />
        <ActionButton
          state={detailState}
          onClick={handleViewDetails}
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

function LocationResultsView() {
  const { data, app, isConnected, error } = useMcpView<LocationResultsContent>(
    "location-results",
    (sc) => !!sc?.locations,
  );

  if (error) return <ErrorDisplay message={error.message} />;
  if (!isConnected || !data) return <Loading />;

  const { locations } = data;

  if (locations.length === 0) {
    return (
      <div className="p-4 max-w-4xl mx-auto">
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 tracking-tight mb-1">
          Store Locations
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
                d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"
              />
            </svg>
          }
          message="No locations found"
          description="Try a different zip code or chain name."
        />
      </div>
    );
  }

  const handleSetPreferred = async (id: string) => {
    const result = await app?.callServerTool({
      name: "set_preferred_location",
      arguments: { locationId: id },
    });
    if (result?.isError) {
      throw new Error("Failed to set preferred location");
    }
  };

  const handleViewDetails = async (id: string) => {
    const result = await app?.callServerTool({
      name: "get_location_details",
      arguments: { locationId: id },
    });
    if (result?.isError) {
      throw new Error("Failed to load details");
    }
  };

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="mb-5">
        <div className="flex items-center gap-2.5">
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 tracking-tight">
            Store Locations
          </h1>
          <Badge variant="blue">{locations.length} found</Badge>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {locations.map((loc) => (
          <LocationCard
            key={loc.locationId}
            location={loc}
            onSetPreferred={handleSetPreferred}
            onViewDetails={handleViewDetails}
          />
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <LocationResultsView />,
);

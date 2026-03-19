import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge } from "../shared/components.js";
import type { LocationData, LocationResultsContent } from "../shared/types.js";

function LocationCard({
  location,
  onSetPreferred,
  onViewDetails,
}: {
  location: LocationData;
  onSetPreferred: (id: string) => void;
  onViewDetails: (id: string) => void;
}) {
  const id = location.locationId || "";
  return (
    <div className="bg-white rounded-xl p-4 border border-gray-200/80 shadow-sm hover:shadow-md hover:border-gray-300/80 transition-all duration-200 dark:bg-gray-800 dark:border-gray-700/80 dark:hover:border-gray-600/80">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-sm text-gray-900 dark:text-gray-100">
            {location.name || "Unknown Store"}
          </div>
          {location.chain && (
            <div className="mt-1">
              <Badge variant="blue">{location.chain}</Badge>
            </div>
          )}
        </div>
      </div>
      {location.address && (
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-2 flex items-start gap-1.5">
          <svg
            aria-hidden="true"
            className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 mt-0.5 flex-shrink-0"
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
            {location.address.addressLine1}
            <br />
            {location.address.city}, {location.address.state}{" "}
            {location.address.zipCode}
          </span>
        </div>
      )}
      {location.phone && (
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 flex items-center gap-1.5">
          <svg
            aria-hidden="true"
            className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500"
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
      <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 font-mono">
        ID: {id}
      </div>
      <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 active:bg-blue-800 transition-colors"
          onClick={() => onSetPreferred(id)}
        >
          <svg
            aria-hidden="true"
            className="w-3.5 h-3.5"
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
          Set Preferred
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg bg-gray-50 px-3.5 py-2 text-xs font-semibold text-gray-700 ring-1 ring-gray-200 hover:bg-gray-100 active:bg-gray-200 transition-colors dark:bg-gray-700 dark:text-gray-200 dark:ring-gray-600 dark:hover:bg-gray-600"
          onClick={() => onViewDetails(id)}
        >
          Details
        </button>
      </div>
    </div>
  );
}

function LocationResultsView() {
  const [data, setData] = useState<LocationResultsContent | null>(null);

  const { app, isConnected, error } = useApp({
    appInfo: { name: "location-results", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (appInstance) => {
      appInstance.ontoolresult = (result) => {
        const content = result.structuredContent as
          | LocationResultsContent
          | undefined;
        if (content?.locations) {
          setData(content);
        }
      };
      appInstance.onerror = console.error;
    },
  });

  useHostStyles(app, app?.getHostContext());

  if (error) {
    return (
      <div className="text-center py-12 text-gray-400 dark:text-gray-500">
        Error: {error.message}
      </div>
    );
  }
  if (!isConnected || !data) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400 dark:text-gray-500 gap-2">
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

  const { locations } = data;

  if (locations.length === 0) {
    return (
      <div className="p-4 max-w-4xl mx-auto">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6">
          Store Locations
        </h1>
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <svg
            aria-hidden="true"
            className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600"
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
          <p className="text-sm">No locations found.</p>
        </div>
      </div>
    );
  }

  const handleSetPreferred = (id: string) => {
    app?.callServerTool({
      name: "set_preferred_location",
      arguments: { locationId: id },
    });
  };

  const handleViewDetails = (id: string) => {
    app?.callServerTool({
      name: "get_location_details",
      arguments: { locationId: id },
    });
  };

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          Store Locations
        </h1>
        <Badge variant="blue">{locations.length} found</Badge>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

import { useApp } from "@modelcontextprotocol/ext-apps/react";
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
    <div className="card">
      <div className="product-name">{location.name || "Unknown Store"}</div>
      {location.chain && <Badge variant="blue">{location.chain}</Badge>}
      {location.address && (
        <div className="meta-item" style={{ marginTop: 6 }}>
          {location.address.addressLine1}
          <br />
          {location.address.city}, {location.address.state}{" "}
          {location.address.zipCode}
        </div>
      )}
      {location.phone && (
        <div className="meta-item" style={{ marginTop: 2 }}>
          {location.phone}
        </div>
      )}
      <div className="meta-item" style={{ marginTop: 2 }}>
        ID: {id}
      </div>
      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onSetPreferred(id)}
        >
          Set as Preferred
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginLeft: 6 }}
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

  if (error) {
    return <div className="empty-state">Error: {error.message}</div>;
  }
  if (!isConnected || !data) {
    return <div id="loading">Loading...</div>;
  }

  const { locations } = data;

  if (locations.length === 0) {
    return (
      <>
        <div className="header">Store Locations</div>
        <div className="empty-state">No locations found.</div>
      </>
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
    <>
      <div className="header">
        Store Locations <Badge variant="blue">{locations.length} found</Badge>
      </div>
      <div className="grid grid-2">
        {locations.map((loc) => (
          <LocationCard
            key={loc.locationId}
            location={loc}
            onSetPreferred={handleSetPreferred}
            onViewDetails={handleViewDetails}
          />
        ))}
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<LocationResultsView />);

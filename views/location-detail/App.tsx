import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge } from "../shared/components.js";
import type { LocationDetailContent } from "../shared/types.js";

function LocationDetailView() {
  const [data, setData] = useState<LocationDetailContent | null>(null);

  const { app, isConnected, error } = useApp({
    appInfo: { name: "location-detail", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (appInstance) => {
      appInstance.ontoolresult = (result) => {
        const content = result.structuredContent as
          | LocationDetailContent
          | undefined;
        if (content?.location) {
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

  const { location } = data;
  const id = location.locationId || "";

  const handleSetPreferred = () => {
    app?.callServerTool({
      name: "set_preferred_location",
      arguments: { locationId: id },
    });
  };

  return (
    <div
      className="card"
      style={{ border: "none", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
    >
      <div style={{ fontSize: 20, fontWeight: 700 }}>
        {location.name || "Unknown Store"}
      </div>
      {location.chain && <Badge variant="blue">{location.chain}</Badge>}

      {location.address && (
        <div className="detail-section">
          <div className="detail-label">Address</div>
          <div className="meta-item">
            {location.address.addressLine1}
            <br />
            {location.address.city}, {location.address.state}{" "}
            {location.address.zipCode}
          </div>
        </div>
      )}

      {location.phone && (
        <div className="detail-section">
          <div className="detail-label">Phone</div>
          <div className="meta-item">{location.phone}</div>
        </div>
      )}

      <div className="detail-section">
        <div className="detail-label">Location ID</div>
        <div className="meta-item">{id}</div>
      </div>

      {location.departments && location.departments.length > 0 && (
        <div className="detail-section">
          <div className="detail-label">Departments</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {location.departments
              .filter((d) => d.name)
              .map((d) => (
                <Badge key={d.name} variant="gray">
                  {d.name}
                  {d.phone ? ` (${d.phone})` : ""}
                </Badge>
              ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSetPreferred}
        >
          Set as Preferred Store
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<LocationDetailView />);

import type { components as LocationComponents } from "../../services/kroger/location.js";
import { Badge, esc } from "./shared.js";

type Location = LocationComponents["schemas"]["locations.location"];

function LocationCard({ location }: { location: Location }) {
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
          onClick={
            `toolCall('set_preferred_location',{locationId:'${esc(id)}'})` as never
          }
        >
          Set as Preferred
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginLeft: 6 }}
          onClick={
            `toolCall('get_location_details',{locationId:'${esc(id)}'})` as never
          }
        >
          Details
        </button>
      </div>
    </div>
  );
}

export function LocationResults({ locations }: { locations: Location[] }) {
  if (locations.length === 0) {
    return (
      <>
        <div className="header">Store Locations</div>
        <div className="empty-state">No locations found.</div>
      </>
    );
  }

  return (
    <>
      <div className="header">
        Store Locations <Badge variant="blue">{locations.length} found</Badge>
      </div>
      <div className="grid grid-2">
        {locations.map((loc) => (
          <LocationCard key={loc.locationId} location={loc} />
        ))}
      </div>
    </>
  );
}

export function LocationDetail({ location }: { location: Location }) {
  const id = location.locationId || "";
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
          onClick={
            `toolCall('set_preferred_location',{locationId:'${esc(id)}'})` as never
          }
        >
          Set as Preferred Store
        </button>
      </div>
    </div>
  );
}

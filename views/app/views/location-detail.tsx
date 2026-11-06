import { locationToMapsUrl } from "../location-maps.js";
import {
  type ShoppingAppClient,
  type StoreDetailContent,
  openExternalLink,
} from "../../shared/types.js";

import { useCallback } from "react";

import { Badge } from "../../shared/components.js";
import { PreferredStoreButton } from "../location-actions.js";

type LocationDetailViewProps = {
  data: StoreDetailContent;
  app: ShoppingAppClient | null;
  canCallTools: boolean;
};

export function LocationDetailView({ data, app, canCallTools }: LocationDetailViewProps) {
  const { store: location } = data;
  const id = location.locationId ?? "";

  const mapsUrl = locationToMapsUrl(location);

  const handleOpenMaps = useCallback(() => {
    if (mapsUrl) {
      openExternalLink(app, mapsUrl).catch(console.error);
    }
  }, [app, mapsUrl]);

  return (
    <div className="mx-auto max-w-2xl animate-in px-3.5 py-3 fade-in slide-in-from-bottom-1">
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-be border-border px-4 pbs-4 pbe-3">
          <div className="flex items-start gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded bg-gray-100 text-gray-500">
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
            <div>
              <h1 className="text-sm font-semibold text-gray-900">
                {location.name?.length ? location.name : "Unknown Store"}
              </h1>
              {location.chain && (
                <div className="mbs-0.5">
                  <Badge variant="secondary" tone="muted">
                    {location.chain}
                  </Badge>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 px-4 py-3">
          {location.address && (
            <div>
              <p className="mbe-1 text-xs font-semibold tracking-wider text-gray-400 uppercase">
                Address
              </p>
              <div className="flex items-start gap-1.5 text-xs text-gray-700">
                <svg
                  aria-hidden="true"
                  className="mbs-0.5 size-3.5 shrink-0 text-gray-400"
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
                  {location.address.city}, {location.address.state} {location.address.zipCode}
                </span>
              </div>
            </div>
          )}

          {location.phone && (
            <div>
              <p className="mbe-1 text-xs font-semibold tracking-wider text-gray-400 uppercase">
                Phone
              </p>
              <div className="flex items-center gap-1.5 text-xs text-gray-700">
                <svg
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-gray-400"
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
            </div>
          )}

          {location.departments && location.departments.length > 0 && (
            <div>
              <p className="mbe-1.5 text-xs font-semibold tracking-wider text-gray-400 uppercase">
                Departments · {location.departments.length}
              </p>
              <div className="flex flex-wrap gap-1">
                {location.departments
                  .filter((d) => d.name)
                  .map((d) => (
                    <Badge key={d.name} variant="secondary" tone="muted">
                      {d.name}
                    </Badge>
                  ))}
              </div>
            </div>
          )}

          <div>
            <p className="mbe-1 text-xs font-semibold tracking-wider text-gray-400 uppercase">
              Location ID
            </p>
            <p className="font-mono text-xs text-gray-400">{id}</p>
          </div>
        </div>

        <div className="flex gap-1.5 px-4 pbs-1 pbe-4">
          <PreferredStoreButton
            app={app}
            storeId={id}
            canCallTools={canCallTools}
            idleLabel="Set as Preferred Store"
            doneLabel="Set as Preferred!"
          />
          {mapsUrl && (
            <button
              type="button"
              onClick={handleOpenMaps}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-gray-200 bg-transparent px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-300 hover:bg-gray-50"
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
                  d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z"
                />
              </svg>
              Open in Maps
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

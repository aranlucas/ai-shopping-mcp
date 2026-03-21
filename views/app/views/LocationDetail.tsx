import type { App } from "@modelcontextprotocol/ext-apps/react";
import { useState } from "react";
import { ActionButton, Badge } from "../../shared/components.js";
import { callTool, type LocationDetailContent } from "../../shared/types.js";

export function LocationDetailView({
  data,
  app,
  canCallTools,
}: {
  data: LocationDetailContent;
  app: App | null;
  canCallTools: boolean;
}) {
  const [prefState, setPrefState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const { location } = data;
  const id = location.locationId || "";

  const handleSetPreferred = async () => {
    setPrefState("loading");
    try {
      const result = await callTool(app, {
        name: "set_preferred_location",
        arguments: { locationId: id },
      });
      if (result?.isError) throw new Error("Failed");
      setPrefState("done");
    } catch {
      setPrefState("error");
      setTimeout(() => setPrefState("idle"), 2000);
    }
  };

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm overflow-hidden">
        <div className="px-5 pt-5 pb-4 border-b border-gray-100">
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <svg
                aria-hidden="true"
                className="w-5 h-5 text-blue-500"
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
              <h1 className="text-base font-bold text-gray-900">
                {location.name || "Unknown Store"}
              </h1>
              {location.chain && (
                <div className="mt-1">
                  <Badge variant="blue">{location.chain}</Badge>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="px-5 py-4 space-y-4">
          {location.address && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                Address
              </p>
              <div className="text-sm text-gray-700 flex items-start gap-2">
                <svg
                  aria-hidden="true"
                  className="w-4 h-4 text-gray-400 mt-0.5 shrink-0"
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
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                Phone
              </p>
              <div className="text-sm text-gray-700 flex items-center gap-2">
                <svg
                  aria-hidden="true"
                  className="w-4 h-4 text-gray-400 shrink-0"
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
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Departments ({location.departments.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {location.departments
                  .filter((d) => d.name)
                  .map((d) => (
                    <Badge key={d.name} variant="gray">
                      {d.name}
                    </Badge>
                  ))}
              </div>
            </div>
          )}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
              Location ID
            </p>
            <p className="text-xs text-gray-400 font-mono">{id}</p>
          </div>
        </div>
        <div className="px-5 pb-5 pt-1">
          <ActionButton
            state={prefState}
            onClick={handleSetPreferred}
            disabled={!canCallTools || prefState === "done"}
            idleLabel="Set as Preferred Store"
            loadingLabel="Saving..."
            doneLabel="Set as Preferred!"
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
        </div>
      </div>
    </div>
  );
}

import type { PreferredStoreContent } from "../../shared/types.js";

export function PreferredStoreView({ data }: { data: PreferredStoreContent }) {
  const { store } = data;

  return (
    <div className="mx-auto max-w-2xl animate-in px-3.5 py-3 fade-in slide-in-from-bottom-1">
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-green-50 text-green-600">
            <svg
              aria-hidden="true"
              className="size-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-gray-900">Preferred store saved</h1>
            <p className="text-xs text-gray-500">{data.actionDetail}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 px-4 py-3">
          <div>
            <p className="text-xs font-semibold tracking-wider text-gray-400 uppercase">Store</p>
            <p className="text-xs font-medium text-gray-800">{store.locationName}</p>
          </div>
          {store.address && (
            <div>
              <p className="text-xs font-semibold tracking-wider text-gray-400 uppercase">
                Address
              </p>
              <p className="text-xs text-gray-600">{store.address}</p>
            </div>
          )}
          <p className="font-mono text-xs text-gray-400">storeId={store.locationId}</p>
        </div>
      </div>
    </div>
  );
}

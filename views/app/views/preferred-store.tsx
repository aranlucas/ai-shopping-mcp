import type { PreferredStoreContent } from "../../shared/types.js";

export function PreferredStoreView({ data }: { data: PreferredStoreContent }) {
  const { store } = data;

  return (
    <div className="px-3.5 py-3 max-w-2xl mx-auto animate-view-in">
      <div className="bg-[var(--app-card-bg)] rounded-lg border border-[var(--app-border)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--app-border)] flex items-center gap-2.5">
          <div className="shrink-0 w-8 h-8 rounded-full bg-green-50 text-green-600 flex items-center justify-center">
            <svg
              aria-hidden="true"
              className="w-4 h-4"
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
            <p className="text-[11px] text-gray-500">{data.actionDetail}</p>
          </div>
        </div>
        <div className="px-4 py-3 space-y-2">
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              Store
            </p>
            <p className="text-xs font-medium text-gray-800">{store.locationName}</p>
          </div>
          {store.address && (
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                Address
              </p>
              <p className="text-xs text-gray-600">{store.address}</p>
            </div>
          )}
          <p className="text-[10px] text-gray-400 font-mono">storeId={store.locationId}</p>
        </div>
      </div>
    </div>
  );
}

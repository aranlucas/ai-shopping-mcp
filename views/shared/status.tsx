/** Shared loading spinner and error display for MCP views. */

export function Loading({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
      <svg
        aria-hidden="true"
        className="animate-spin h-6 w-6 text-blue-500"
        viewBox="0 0 24 24"
        fill="none"
      >
        <circle
          className="opacity-20"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="3"
        />
        <path
          className="opacity-80"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      <span className="text-sm">{message ?? "Loading..."}</span>
    </div>
  );
}

export function ErrorDisplay({ message }: { message: string }) {
  return (
    <div className="m-4 rounded-xl bg-red-50 border border-red-200 p-4 flex items-start gap-3">
      <svg
        aria-hidden="true"
        className="w-4 h-4 text-red-500 mt-0.5 shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
        />
      </svg>
      <div>
        <p className="text-sm font-medium text-red-700">Something went wrong</p>
        <p className="text-xs text-red-600/80 mt-0.5">{message}</p>
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  message,
  description,
}: {
  icon: React.ReactNode;
  message: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-4">
      <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center mb-3 text-gray-400">
        {icon}
      </div>
      <p className="text-sm font-medium text-gray-600">{message}</p>
      {description && <p className="text-xs text-gray-400 mt-1 max-w-xs">{description}</p>}
    </div>
  );
}

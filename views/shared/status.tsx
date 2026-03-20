/** Shared loading spinner and error display for MCP views. */

export function Loading() {
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

export function ErrorDisplay({ message }: { message: string }) {
  return (
    <div className="text-center py-12 text-gray-400 dark:text-gray-500">
      Error: {message}
    </div>
  );
}

import { ReactNode } from "react";

export function Loading({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-2.5">
      <svg
        aria-hidden="true"
        className="animate-spin h-5 w-5 text-[var(--app-accent)]"
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
      <span className="text-xs text-gray-400">{message ?? "Loading..."}</span>
    </div>
  );
}

export function ErrorDisplay({ message }: { message: string }) {
  return (
    <div className="mx-3.5 my-3 rounded-lg bg-red-50 border border-red-100 px-3.5 py-3 flex items-start gap-2.5">
      <svg
        aria-hidden="true"
        className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2.5}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
        />
      </svg>
      <div>
        <p className="text-xs font-medium text-red-700">Something went wrong</p>
        <p className="text-xs text-red-500 mt-0.5 leading-snug">{message}</p>
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  message,
  description,
}: {
  icon: ReactNode;
  message: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center px-4">
      <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center mb-3 text-gray-400">
        {icon}
      </div>
      <p className="text-xs font-medium text-gray-600">{message}</p>
      {description && (
        <p className="text-[11px] text-gray-400 mt-1 max-w-xs leading-relaxed">{description}</p>
      )}
    </div>
  );
}

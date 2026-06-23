import type { ReactNode } from "react";

import { AlertCircleIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert.js";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/shared/ui/empty.js";
import { Skeleton } from "@/shared/ui/skeleton.js";
import { Spinner } from "@/shared/ui/spinner.js";

export function Loading({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-2.5">
      <Spinner className="h-5 w-5 text-[var(--app-accent)]" />
      <span className="text-xs text-gray-400">{message ?? "Loading..."}</span>
    </div>
  );
}

export function ErrorDisplay({ message }: { message: string }) {
  return (
    <Alert variant="destructive" className="mx-3.5 my-3">
      <AlertCircleIcon />
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
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
    <Empty className="py-14 border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{message}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
    </Empty>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <Skeleton className="w-full aspect-square rounded-none" />
      <div className="p-3 space-y-2">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-4 w-1/3 mt-1" />
        <div className="flex gap-1 mt-1">
          <Skeleton className="h-4 w-10 rounded-full" />
          <Skeleton className="h-4 w-14 rounded-full" />
        </div>
      </div>
      <div className="px-3 pb-3 flex gap-1.5">
        <Skeleton className="h-6 flex-1 rounded-lg" />
        <Skeleton className="h-6 w-14 rounded-lg" />
      </div>
    </div>
  );
}

export function DealCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-2">
      <Skeleton className="h-3.5 w-3/4" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <Skeleton className="h-6 w-1/3 mt-1" />
      <div className="pt-2 flex gap-1.5">
        <Skeleton className="h-6 w-24 rounded-lg" />
        <Skeleton className="h-6 w-20 rounded-lg" />
      </div>
    </div>
  );
}

export function ItemRowSkeleton() {
  return (
    <div className="flex items-center gap-2.5 py-2.5">
      <Skeleton className="w-6 h-6 rounded shrink-0" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-2.5 w-1/4" />
      </div>
      <Skeleton className="h-6 w-6 rounded" />
    </div>
  );
}

export function ProductSearchSkeleton() {
  return (
    <div className="px-3.5 py-3 max-w-4xl mx-auto">
      <div className="mb-4 flex items-center gap-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-12" />
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="mb-6">
          <div className="flex items-center gap-2 mb-2.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-12" />
          </div>
          <div className="flex gap-2 overflow-hidden">
            {[0, 1, 2].map((j) => (
              <div key={j} className="shrink-0 w-52">
                <ProductCardSkeleton />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function WeeklyDealsSkeleton() {
  return (
    <div className="px-3.5 py-3 max-w-4xl mx-auto">
      <div className="mb-4 flex items-center gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-14" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <DealCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

export function ListSkeleton() {
  return (
    <div className="px-3.5 py-3 max-w-2xl mx-auto">
      <div className="mb-4 flex items-center gap-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-14" />
      </div>
      <div className="divide-y divide-border">
        {[0, 1, 2, 3, 4].map((i) => (
          <ItemRowSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

export function RecipesSkeleton() {
  return (
    <div className="px-3.5 py-3 max-w-4xl mx-auto">
      <div className="mb-4 flex items-center gap-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-3 w-16" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-3 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <div className="flex gap-1 mt-1">
              <Skeleton className="h-4 w-12 rounded-full" />
              <Skeleton className="h-4 w-10 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

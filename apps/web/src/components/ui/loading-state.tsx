import * as React from "react";
import { cn } from "./utils";
import { Loader2 } from "lucide-react";

/** Full-page loading overlay */
export function LoadingOverlay({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center py-20",
        className,
      )}
    >
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        <p className="text-[13px] text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

/** Inline loading spinner with optional message */
export function LoadingSpinner({
  message,
  className,
}: {
  message?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2 text-[13px] text-muted-foreground", className)}>
      <Loader2 className="w-4 h-4 animate-spin" />
      {message && <span>{message}</span>}
    </div>
  );
}

/** Skeleton line */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

/** Skeleton card for table rows */
export function SkeletonTableRow({
  columns = 5,
  rows = 5,
}: {
  columns?: number;
  rows?: number;
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <tr key={rowIdx} className="border-b border-border">
          {Array.from({ length: columns }).map((_, colIdx) => (
            <td key={colIdx} className="px-5 py-3.5">
              <Skeleton className="h-4 w-full max-w-[120px]" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Skeleton card for grid layouts */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-xl border border-black/5 bg-card p-5 space-y-3">
      <div className="flex items-center gap-3">
        <Skeleton className="w-10 h-10 rounded-lg shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3 w-full" />
      ))}
    </div>
  );
}

/** Skeleton grid for catalog listings */
export function SkeletonCatalogGrid({
  count = 6,
}: {
  count?: number;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} lines={2} />
      ))}
    </div>
  );
}

/** Skeleton stat cards row */
export function SkeletonStatCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-black/5 bg-card p-5 space-y-3"
        >
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="w-9 h-9 rounded-xl" />
          </div>
          <Skeleton className="h-8 w-24" />
        </div>
      ))}
    </div>
  );
}

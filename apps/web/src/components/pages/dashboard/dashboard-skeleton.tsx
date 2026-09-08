import { Skeleton, SkeletonCard } from '@/components/ui/loading-state';

const PILL_WIDTHS = ['w-48', 'w-44', 'w-52', 'w-40', 'w-56', 'w-36'];

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-4 w-40 mb-3" />
        <div className="flex flex-wrap gap-2">
          {PILL_WIDTHS.map((width, index) => (
            <Skeleton key={index} className={`h-11 ${width} rounded-full`} />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:auto-rows-[minmax(120px,1fr)] md:grid-flow-dense lg:grid-cols-5">
        <Skeleton className="col-span-2 rounded-xl md:row-span-2 h-full min-h-[200px]" />
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rounded-xl border border-border bg-card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="w-9 h-9 rounded-xl" />
            </div>
            <Skeleton className="h-7 w-14" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <SkeletonCard lines={6} />
        </div>
        <SkeletonCard lines={4} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <SkeletonCard lines={5} />
        <SkeletonCard lines={4} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <SkeletonCard lines={4} />
        <SkeletonCard lines={4} />
      </div>
    </div>
  );
}

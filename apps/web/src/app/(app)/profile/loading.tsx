import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";

/** Progress summary, then one skeleton row per plan group. */
export default function Loading() {
  return (
    <SkeletonGroup className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="hidden h-10 w-56 rounded-lg sm:block" />
      </div>
      <div className="grid gap-6 rounded-xl border border-border p-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-2.5 w-full rounded-full" />
          <Skeleton className="h-3 w-80 max-w-full" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-8 w-36 rounded-lg" />
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-border">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-b-0">
            <Skeleton className="h-3 w-4" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3.5 flex-1" />
            <Skeleton className="h-3 w-8" />
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}

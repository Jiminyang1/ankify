import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";

/**
 * Default route-segment loading UI. Routes whose shape differs a lot from this
 * grid (problems, review, analysis) ship their own loading.tsx.
 */
export default function Loading() {
  return (
    <SkeletonGroup className="space-y-5">
      <Skeleton className="h-8 w-48 rounded-md" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-xl border border-border bg-surface p-5">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}

import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";

/** Mirrors a suggestion card so the layout does not jump on first paint. */
export default function Loading() {
  return (
    <SkeletonGroup className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="space-y-3 rounded-xl border border-border p-5">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-2/3" />
        <div className="flex gap-2 pt-2">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-8 w-20" />
        </div>
      </div>
    </SkeletonGroup>
  );
}

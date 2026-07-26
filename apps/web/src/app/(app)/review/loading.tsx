import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";

/** Two-pane review workspace: statement + rating on the left, tabs on the right. */
export default function Loading() {
  return (
    <SkeletonGroup className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-border p-5">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-24 w-full rounded-md" />
          <Skeleton className="h-4 w-3/4" />
          <div className="flex gap-1.5 pt-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 flex-1 rounded-md" />
            ))}
            <Skeleton className="h-12 w-20 rounded-md" />
          </div>
        </div>
        <div className="space-y-3 rounded-xl border border-border p-5">
          <div className="flex gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 flex-1 rounded-md" />
            ))}
          </div>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-32 w-full rounded-md" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    </SkeletonGroup>
  );
}

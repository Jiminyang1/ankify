import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";

/** Summary card, then roadmap-shaped node placeholders. */
export default function Loading() {
  return (
    <SkeletonGroup className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-6 rounded-xl border border-border p-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-2.5 w-full rounded-full" />
          <Skeleton className="h-3 w-80 max-w-full" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-5 w-48" />
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-border px-3 py-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-1.5 w-full rounded-full" />
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}

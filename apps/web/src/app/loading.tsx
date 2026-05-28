/**
 * Default route-segment loading UI. Renders a lightweight skeleton during
 * server-component data fetches so navigation feels instant instead of blank.
 */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-5" aria-hidden>
      <div className="h-8 w-48 rounded-md bg-subtle" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-xl border border-border bg-surface p-5">
            <div className="h-4 w-3/4 rounded bg-subtle" />
            <div className="h-3 w-1/2 rounded bg-subtle" />
            <div className="h-3 w-2/3 rounded bg-subtle" />
          </div>
        ))}
      </div>
    </div>
  );
}

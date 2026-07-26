import { cn } from "@/lib/utils";

/**
 * Placeholder block for loading UI. Route-level `loading.tsx` files compose
 * these so every skeleton pulses at the same rate and uses the same surface,
 * instead of each route inventing its own grey.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("rounded bg-subtle", className)} />;
}

/** Wrapper that applies the shared pulse and hides the skeleton from a11y. */
export function SkeletonGroup({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("animate-pulse motion-reduce:animate-none", className)} aria-hidden>
      {children}
    </div>
  );
}

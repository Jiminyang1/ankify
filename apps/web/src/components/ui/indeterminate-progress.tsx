import { cn } from "@/lib/utils";

/** Animated progress for work whose completion percentage is unknown. */
export function IndeterminateProgress({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      className={cn("h-1.5 overflow-hidden rounded-full bg-subtle", className)}
    >
      <div className="h-full w-2/5 animate-indeterminate rounded-full bg-accent/80 motion-reduce:animate-pulse" />
    </div>
  );
}

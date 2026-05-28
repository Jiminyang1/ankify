import { cn } from "@/lib/utils";

/**
 * Pure-CSS hover tooltip. Server-component safe (no hooks).
 * Renders a small "i" affordance; the explanation pops on hover/focus.
 * Note: keep out of `overflow-hidden` containers or the popover gets clipped.
 */
export function InfoTip({
  label,
  className,
  align = "center",
}: {
  label: string;
  className?: string;
  align?: "center" | "left" | "right";
}) {
  const position =
    align === "left"
      ? "left-0"
      : align === "right"
        ? "right-0"
        : "left-1/2 -translate-x-1/2";

  return (
    <span className={cn("group/info relative inline-flex align-middle", className)}>
      <span
        tabIndex={0}
        role="img"
        aria-label={label}
        className="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-border text-[9px] font-semibold leading-none text-muted transition-colors hover:border-accent hover:text-accent focus:outline-none focus-visible:border-accent focus-visible:text-accent"
      >
        i
      </span>
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute bottom-full z-30 mb-1.5 w-56 rounded-lg border border-border bg-surface px-3 py-2 text-left text-xs font-normal normal-case leading-snug tracking-normal text-fg opacity-0 shadow-card-hover transition-opacity duration-150 group-hover/info:opacity-100 group-focus-within/info:opacity-100",
          position,
        )}
      >
        {label}
      </span>
    </span>
  );
}

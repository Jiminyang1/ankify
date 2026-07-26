import { cn } from "@/lib/utils";

/**
 * Pending indicator for glyph-only or fixed-width controls, where swapping the
 * label for text would resize the button. Inherits `currentColor`, so it works
 * on any button variant. Prefer a text label ("Saving...") when there is room.
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent opacity-75 motion-reduce:animate-[spin_2s_linear_infinite]",
        className,
      )}
    />
  );
}

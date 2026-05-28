import type { NotesSaveStatus } from "@/lib/notes-autosave";
import { cn } from "@/lib/utils";

/**
 * Tiny autosave indicator. Shows a fading "Saving…/Saved" hint, and an explicit
 * "Save failed — Retry" affordance when a save errors so the user never assumes
 * a failed save succeeded.
 */
export function SaveStatus({
  status,
  onRetry,
  className,
}: {
  status: NotesSaveStatus;
  onRetry: () => void;
  className?: string;
}) {
  if (status === "error") {
    return (
      <span className={cn("inline-flex items-center gap-2 text-[10px]", className)}>
        <span className="text-danger">Save failed</span>
        <button
          type="button"
          onClick={onRetry}
          className="rounded border border-danger/40 px-1.5 py-0.5 font-medium text-danger transition-colors hover:bg-danger/10"
        >
          Retry
        </button>
      </span>
    );
  }
  return (
    <span
      className={cn(
        "pointer-events-none text-[10px] text-muted tabular-nums transition-opacity",
        status === "idle" ? "opacity-0" : "opacity-70",
        className,
      )}
    >
      {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}
    </span>
  );
}

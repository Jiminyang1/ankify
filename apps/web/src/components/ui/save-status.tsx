"use client";

import type { NotesSaveStatus } from "@/lib/notes-autosave";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/components/LanguageProvider";
import { Button } from "@/components/ui/button";

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
  const { t } = useLanguage();
  if (status === "error") {
    return (
      <span
        className={cn("inline-flex items-center gap-2 text-[10px]", className)}
        role="alert"
      >
        <span className="text-danger">{t.common.saveFailed}</span>
        <Button
          variant="danger"
          size="xs"
          onClick={onRetry}
        >
          {t.common.retry}
        </Button>
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
      role="status"
      aria-live="polite"
    >
      {status === "saving" ? t.common.saving : status === "saved" ? t.common.saved : ""}
    </span>
  );
}

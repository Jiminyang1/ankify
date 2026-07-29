"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/LanguageProvider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { notifyReviewQueueUpdated } from "@/lib/review-queue-event";

/** Dev-only "wipe everything" button. The server route also enforces
 *  NODE_ENV !== "production", so this is double-guarded. */
export function DevResetButton() {
  const router = useRouter();
  const { t } = useLanguage();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const resetAllData = () => {
    startTransition(async () => {
      setStatus(null);
      setResetError(null);
      const res = await fetch("/api/dev/reset", { method: "POST" });
      if (!res.ok) {
        setResetError(t.analysis.failed(res.status));
        return;
      }
      setStatus(t.analysis.wiped);
      setConfirmOpen(false);
      notifyReviewQueueUpdated(0);
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-3">
      <ConfirmDialog
        open={confirmOpen}
        title={t.analysis.resetAllData}
        description={t.analysis.resetConfirm}
        cancelLabel={t.common.cancel}
        confirmLabel={pending ? t.analysis.wiping : t.analysis.resetAllData}
        busy={pending}
        error={resetError}
        onClose={() => {
          if (!pending) setConfirmOpen(false);
        }}
        onConfirm={resetAllData}
      />
      <Button
        variant="danger"
        size="sm"
        onClick={() => {
          setStatus(null);
          setResetError(null);
          setConfirmOpen(true);
        }}
        disabled={pending}
      >
        {pending ? t.analysis.wiping : t.analysis.resetAllData}
      </Button>
      {status && <span className="text-xs text-muted">{status}</span>}
    </div>
  );
}

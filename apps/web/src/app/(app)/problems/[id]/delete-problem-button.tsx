"use client";

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/lib/use-hydrated";
import { notifyReviewQueueUpdated } from "@/lib/review-queue-event";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import { useLanguage } from "@/components/LanguageProvider";

export function DeleteProblemButton({
  problemId,
  problemTitle,
}: {
  problemId: string;
  problemTitle: string;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const mounted = useHydrated();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    if (busy) return;
    setOpen(false);
    setError(null);
  }, [busy]);

  useDialogA11y({
    open,
    onClose: close,
    containerRef: dialogRef,
    initialFocusRef: cancelRef,
  });

  async function confirmDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/problems/${problemId}`, { method: "DELETE" });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      notifyReviewQueueUpdated();
      router.replace("/problems");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.detail.deleteFailed);
      setBusy(false);
    }
  }

  const modal =
    open &&
    mounted &&
    createPortal(
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6" role="presentation">
        <button
          type="button"
          aria-hidden
          className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
          onClick={close}
        />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-problem-title"
          tabIndex={-1}
          className="relative z-[101] w-full max-w-md overflow-hidden rounded-xl border border-border bg-surface shadow-2xl ring-1 ring-black/5 dark:ring-white/10"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="border-b border-border px-5 py-4">
            <h2 id="delete-problem-title" className="text-base font-semibold">
              {t.detail.deleteProblem}
            </h2>
            <p className="mt-1 text-sm text-muted">{t.detail.deleteWarning}</p>
          </div>
          <div className="space-y-3 px-5 py-4 text-sm">
            <p>
              {t.detail.deletePrompt(problemTitle)}
            </p>
            <p className="text-muted">
              {t.detail.deleteDescription}
            </p>
            {error && (
              <p className="rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            <Button ref={cancelRef} onClick={close} disabled={busy}>
              {t.common.cancel}
            </Button>
            <Button
              onClick={confirmDelete}
              disabled={busy}
              className="border-transparent bg-danger text-danger-contrast shadow-card hover:brightness-95"
            >
              {busy ? t.detail.deleting : t.detail.deleteForever}
            </Button>
          </div>
        </div>
      </div>,
      document.body,
    );

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="text-danger hover:bg-danger/10"
        aria-label={t.detail.deletePrompt(problemTitle)}
      >
        {t.common.delete}
      </Button>
      {modal}
    </>
  );
}

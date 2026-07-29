"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "./button";
import { useHydrated } from "@/lib/use-hydrated";
import { useDialogA11y } from "@/lib/use-dialog-a11y";

export function ConfirmDialog({
  open,
  title,
  description,
  cancelLabel,
  confirmLabel,
  busy = false,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const mounted = useHydrated();
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useDialogA11y({
    open,
    onClose,
    containerRef: dialogRef,
    initialFocusRef: cancelRef,
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6" role="presentation">
      <button
        type="button"
        aria-label={cancelLabel}
        tabIndex={-1}
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="relative z-[101] w-full max-w-md overflow-hidden rounded-xl border border-border bg-surface shadow-2xl ring-1 ring-black/5 dark:ring-white/10"
      >
        <div className="border-b border-border px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold">{title}</h2>
        </div>
        <div className="space-y-3 px-5 py-4 text-sm text-muted">
          <div id={descriptionId} className="whitespace-pre-line">{description}</div>
          {error && <p className="rounded-md bg-danger/10 px-3 py-2 text-xs text-danger" role="alert">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button ref={cancelRef} onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

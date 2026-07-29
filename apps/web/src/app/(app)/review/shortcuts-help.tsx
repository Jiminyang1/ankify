"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/components/LanguageProvider";
import { useDialogA11y } from "@/lib/use-dialog-a11y";

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.5rem] items-center justify-center rounded border border-border bg-subtle px-1.5 py-0.5 text-[11px] font-medium text-fg">
      {children}
    </kbd>
  );
}

function Row({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="text-sm text-muted">{label}</span>
      <span className="flex shrink-0 flex-wrap justify-end gap-1">
        {keys.map((key) => (
          <Key key={key}>{key}</Key>
        ))}
      </span>
    </div>
  );
}

/**
 * Shortcut reference for the review screen. The inline hint only renders at the
 * lg breakpoint, so this dialog is the discoverable path on narrow windows.
 * Opened with "?" (handled by the parent) or the trigger button.
 */
export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDialogA11y({ open, onClose, containerRef: dialogRef, initialFocusRef: closeRef });

  if (!open) return null;

  const groups = t.review.shortcutsGroups;
  const keys = t.review.shortcutsKeys;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t.review.shortcutsTitle}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-card-hover"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold">{t.review.shortcutsTitle}</h2>
          <Button ref={closeRef} size="sm" onClick={onClose}>
            {t.review.shortcutsClose}
          </Button>
        </div>

        <div className="mt-4 space-y-4">
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted">{groups.rating}</h3>
            <div className="mt-1 divide-y divide-border">
              <Row keys={["1", "2", "3", "4"]} label={keys.rate} />
              <Row keys={["Enter"]} label={keys.submit} />
            </div>
          </section>

          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted">{groups.quiz}</h3>
            <div className="mt-1 divide-y divide-border">
              <Row keys={["A", "B", "C", "D"]} label={keys.quizAnswer} />
              <Row keys={["Space"]} label={keys.quizAdvance} />
            </div>
          </section>

          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted">{groups.cards}</h3>
            <div className="mt-1 divide-y divide-border">
              <Row keys={["Space"]} label={keys.cardFlip} />
              <Row keys={["←", "→"]} label={keys.cardNav} />
            </div>
          </section>

          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted">{groups.result}</h3>
            <div className="mt-1 divide-y divide-border">
              <Row keys={["Enter"]} label={keys.resultNext} />
            </div>
          </section>

          <div className="divide-y divide-border border-t border-border pt-1">
            <Row keys={["?"]} label={keys.help} />
          </div>
        </div>

        <p className="mt-4 text-xs text-muted">{t.review.shortcutsNote}</p>
      </div>
    </div>
  );
}

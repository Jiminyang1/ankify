"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

export function DeleteProblemButton({
  problemId,
  problemTitle,
}: {
  problemId: string;
  problemTitle: string;
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const close = useCallback(() => {
    if (busy) return;
    setOpen(false);
    setError(null);
  }, [busy]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  async function confirmDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/problems/${problemId}`, { method: "DELETE" });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      router.replace("/problems");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
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
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-problem-title"
          className="relative z-[101] w-full max-w-md overflow-hidden rounded-xl border border-border bg-surface shadow-2xl ring-1 ring-black/5 dark:ring-white/10"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="border-b border-border px-5 py-4">
            <h2 id="delete-problem-title" className="text-base font-semibold">
              Delete problem
            </h2>
            <p className="mt-1 text-sm text-muted">This cannot be undone.</p>
          </div>
          <div className="space-y-3 px-5 py-4 text-sm">
            <p>
              Permanently delete <span className="font-medium">{problemTitle}</span>?
            </p>
            <p className="text-muted">
              All cards, submissions, quiz sessions, and review history for this problem will also be removed. FSRS scheduling will be lost.
            </p>
            {error && (
              <p className="rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            <button
              type="button"
              onClick={close}
              disabled={busy}
              className="inline-flex items-center rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-subtle disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={busy}
              className="inline-flex items-center rounded-lg bg-danger px-3 py-1.5 text-sm font-medium text-white shadow-card hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Deleting…" : "Delete forever"}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-danger hover:bg-danger/10"
      >
        Delete
      </button>
      {modal}
    </>
  );
}

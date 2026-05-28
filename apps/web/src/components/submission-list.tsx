"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Submission } from "@ankify/db";
import { Pill } from "@/components/ui/pill";
import { HighlightedCode } from "@/components/ui/highlighted-code";
import { cn } from "@/lib/utils";

function formatMemory(memoryKb: number) {
  return `${(memoryKb / 1024).toFixed(1)} MB`;
}

function formatDate(value: Submission["submittedAt"]) {
  if (!value) return "No timestamp";
  return new Date(value).toLocaleString();
}

function hasFailureDetail(s: Submission) {
  return Boolean(s.errorMessage || s.failedTestcase || s.expectedOutput || s.actualOutput);
}

/**
 * Vertically scrollable list of submissions. Each entry is an independently
 * collapsible card; the most recent one is expanded by default. Code blocks
 * expand to a fullscreen overlay for focused reading. Shared by the problem
 * detail page and the review workspace so both render submissions identically.
 */
export function SubmissionList({ submissions }: { submissions: Submission[] }) {
  return (
    <ul className="space-y-3">
      {submissions.map((s, i) => (
        <SubmissionCard
          key={s.id}
          submission={s}
          index={submissions.length - i}
          defaultOpen={i === 0}
        />
      ))}
    </ul>
  );
}

function SubmissionCard({
  submission,
  index,
  defaultOpen,
}: {
  submission: Submission;
  index: number;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const passed = submission.status === "Accepted";
  const meta = [
    submission.language,
    submission.runtimeMs != null ? `${submission.runtimeMs} ms` : null,
    submission.memoryKb != null ? formatMemory(submission.memoryKb) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="overflow-hidden rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 bg-subtle/50 px-4 py-2.5 text-left text-xs transition-colors hover:bg-subtle"
      >
        <span
          aria-hidden
          className={cn("text-muted transition-transform", open ? "rotate-90" : "rotate-0")}
        >
          ▸
        </span>
        <Pill tone={passed ? "success" : "danger"}>{submission.status}</Pill>
        <span className="text-muted tabular-nums">#{index}</span>
        <span className="truncate text-muted">{meta}</span>
        <span className="ml-auto shrink-0 text-muted">{formatDate(submission.submittedAt)}</span>
      </button>

      {open && (
        <>
          {hasFailureDetail(submission) && (
            <div className="space-y-2 border-t border-border bg-danger/5 px-4 py-3 text-xs">
              <FailureDetail label="Error" value={submission.errorMessage} />
              <FailureDetail label="Failed testcase" value={submission.failedTestcase} />
              <FailureDetail label="Expected" value={submission.expectedOutput} />
              <FailureDetail label="Actual" value={submission.actualOutput} />
            </div>
          )}
          <div className="relative border-t border-border">
            <FullscreenButton
              code={submission.code}
              language={submission.language}
              title={`${submission.status} · #${index} · ${formatDate(submission.submittedAt)}`}
            />
            <HighlightedCode code={submission.code} language={submission.language} className="max-h-80" />
          </div>
        </>
      )}
    </li>
  );
}

function FailureDetail({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <span className="font-medium uppercase tracking-wide text-muted">{label}</span>
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-fg">
        {value}
      </pre>
    </div>
  );
}

/** Expand affordance + fullscreen overlay for a single code block. */
function FullscreenButton({
  code,
  language,
  title,
}: {
  code: string;
  language?: string | null;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, close]);

  const modal =
    open &&
    mounted &&
    createPortal(
      <div className="fixed inset-0 z-[100] flex flex-col bg-black/60 p-3 backdrop-blur-sm sm:p-6" role="presentation">
        <button type="button" aria-hidden className="absolute inset-0" onClick={close} />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Submission code"
          className="relative z-[101] mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl ring-1 ring-black/5 dark:ring-white/10"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-subtle/50 px-4 py-2.5 text-xs">
            <div className="flex min-w-0 items-center gap-3">
              {title && <span className="truncate text-muted">{title}</span>}
              <span className="font-mono text-muted">{language}</span>
            </div>
            <button
              type="button"
              onClick={close}
              className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:bg-subtle hover:text-fg"
            >
              Close <span aria-hidden>✕</span>
            </button>
          </div>
          <HighlightedCode code={code} language={language} className="min-h-0 flex-1" />
        </div>
      </div>,
      document.body,
    );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Expand code to fullscreen"
        className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-md border border-border bg-surface/80 px-2 py-1 text-[11px] text-muted backdrop-blur transition-colors hover:bg-subtle hover:text-fg"
      >
        <span aria-hidden>⤢</span> Fullscreen
      </button>
      {modal}
    </>
  );
}

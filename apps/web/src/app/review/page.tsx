"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Problem, Card, Submission } from "@ankify/db";
import type { FsrsRating } from "@ankify/core";
import { DifficultyPill, FsrsStatePill, Pill } from "@/components/ui/pill";
import { Surface } from "@/components/ui/surface";
import { Markdown } from "@/components/ui/markdown";
import { cn, formatInterval } from "@/lib/utils";

type ReviewPayload = {
  problem: (Problem & { cards: Card[]; submissions: Submission[] }) | null;
  previews: Record<FsrsRating, { due: string }> | null;
  queue?: { dueCount: number };
};
type RateResult = {
  ok: true;
  nextDue: string;
  queue?: { dueCount: number; totalDue: number };
};
type Stage = "loading" | "review" | "result" | "empty";

const RATING_BUTTONS: { rating: FsrsRating; label: string; hint: string }[] = [
  { rating: 1, label: "Again", hint: "完全想不起来" },
  { rating: 2, label: "Hard", hint: "想起一点但不稳" },
  { rating: 3, label: "Good", hint: "能讲出主要方法" },
  { rating: 4, label: "Easy", hint: "能讲清方法、复杂度和坑" },
];

export default function ReviewPage() {
  const [data, setData] = useState<ReviewPayload | null>(null);
  const [stage, setStage] = useState<Stage>("loading");
  const [userFsrsRating, setUserFsrsRating] = useState<FsrsRating>(3);
  const [notes, setNotes] = useState("");
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [cardIdx, setCardIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [result, setResult] = useState<RateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadNext = useCallback(async () => {
    setStage("loading");
    setUserFsrsRating(3);
    setNotes("");
    setEditingNotes(false);
    setNotesOpen(false);
    setCardIdx(0);
    setFlipped(false);
    setResult(null);
    setError(null);
    const res = await fetch("/api/review/next", { cache: "no-store" });
    const json = (await res.json()) as ReviewPayload;
    setData(json);
    if (json.problem) {
      setNotes(json.problem.notes ?? "");
    }
    setStage(json.problem ? "review" : "empty");
  }, []);

  useEffect(() => {
    void loadNext();
  }, [loadNext]);

  const submitRating = useCallback(async () => {
    if (!data?.problem || !userFsrsRating) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/review/rate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          problemId: data.problem.id,
          rating: userFsrsRating,
          notes,
        }),
      });
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error ?? "rate_failed");
        setSubmitting(false);
        return;
      }
      setResult((await res.json()) as RateResult);
      setStage("result");
    } catch {
      setError("网络错误，请重试");
    }
    setSubmitting(false);
  }, [data?.problem, userFsrsRating, notes]);

  if (stage === "loading" || !data) return <p className="text-muted p-8 text-center">Loading...</p>;

  if (stage === "empty" || !data.problem) {
    return (
      <Surface className="p-10 text-center">
        <h1 className="text-2xl font-semibold">Nothing due</h1>
        <p className="mt-2 text-sm text-muted">今天没有到期题目。</p>
        <Link href="/problems" className="mt-4 inline-block rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-subtle">
          Browse problems
        </Link>
      </Surface>
    );
  }

  const problem = data.problem;
  const cards = problem.cards ?? [];
  const submissions = problem.submissions ?? [];
  const currentCard = cards[cardIdx] ?? null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <ReviewHeader
        problem={problem}
        cardTotal={cards.length}
        dueCount={result?.queue?.dueCount ?? data.queue?.dueCount ?? 0}
        notesOpen={notesOpen}
        onToggleNotes={() => setNotesOpen((v) => !v)}
        hasNotes={notes.trim().length > 0}
      />

      {stage === "review" && (
        <>
          {/* Main: left problem / right flashcard */}
          <div className="grid gap-4 lg:grid-cols-[1fr_420px]" style={{ height: "calc(100vh - 280px)" }}>
            {/* Left: Problem */}
            <Surface className="flex flex-col overflow-hidden">
              <div className="shrink-0 px-5 py-3 border-b border-border">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Problem context</span>
              </div>
              <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
                {problem.descriptionMd ? (
                  <Markdown>{stripConstraints(problem.descriptionMd)}</Markdown>
                ) : (
                  <p className="text-sm text-muted">No problem description captured.</p>
                )}
                <SubmissionDetails submissions={submissions} />
              </div>
            </Surface>

            {/* Right: Card */}
            <div className="flex flex-col gap-3" style={{ minHeight: 0 }}>
              {currentCard ? (
                <>
                  {/* Card */}
                  <Surface className="flex-1 flex flex-col overflow-hidden" style={{ minHeight: 0, perspective: "800px" }}>
                    {/* Card nav */}
                    <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-border">
                      <button
                        type="button"
                        disabled={cardIdx === 0}
                        onClick={() => { setCardIdx((i) => i - 1); setFlipped(false); }}
                        className="text-xs text-muted hover:text-fg disabled:opacity-30 transition-colors"
                      >
                        ← Prev
                      </button>
                      <span className="text-[11px] text-muted tabular-nums">
                        {cardIdx + 1} / {cards.length}
                      </span>
                      <button
                        type="button"
                        disabled={cardIdx >= cards.length - 1}
                        onClick={() => { setCardIdx((i) => i + 1); setFlipped(false); }}
                        className="text-xs text-muted hover:text-fg disabled:opacity-30 transition-colors"
                      >
                        Next →
                      </button>
                    </div>

                    {/* Card body with flip */}
                    <div
                      className="flex-1 overflow-auto cursor-pointer"
                      style={{ minHeight: 0 }}
                      onClick={() => setFlipped((f) => !f)}
                    >
                      <div
                        className="h-full transition-transform duration-500 ease-in-out"
                        style={{ transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}
                      >
                        {!flipped ? (
                          /* Front */
                          <div className="h-full flex flex-col">
                            <div className="flex-1 flex items-center justify-center p-6">
                              <div>
                                <div className="text-base leading-relaxed text-center max-w-md">
                                  <Markdown>{currentCard.question}</Markdown>
                                </div>
                              </div>
                            </div>
                            <div className="shrink-0 border-t border-border px-4 py-2 text-center">
                              <span className="text-[10px] text-muted">Tap to reveal answer</span>
                            </div>
                          </div>
                        ) : (
                          /* Back — answer */
                          <div
                            className="h-full flex flex-col"
                            style={{ transform: "rotateY(180deg)" }}
                          >
                            <div className="flex-1 overflow-auto p-6 space-y-4">
                              <div className="rounded-lg border border-success/30 bg-success/10 p-4">
                                <div className="text-[10px] font-medium uppercase tracking-wide text-success mb-2">Answer</div>
                                <Markdown className="text-sm font-medium">{currentCard.answer}</Markdown>
                              </div>
                            </div>
                            <div className="shrink-0 border-t border-border px-4 py-2 text-center">
                              <span className="text-[10px] text-muted">Tap to see question</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </Surface>
                </>
              ) : (
                <Surface className="flex-1 flex items-center justify-center">
                  <div className="text-center">
                    <p className="text-sm text-muted">No cards for this problem yet.</p>
                    <Link
                      href={`/problems/${problem.id}`}
                      className="mt-2 inline-block text-xs text-accent hover:underline"
                    >
                      Add a card →
                    </Link>
                  </div>
                </Surface>
              )}

            </div>
          </div>

          {/* Rating */}
          <Surface className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Rating</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {RATING_BUTTONS.map((button) => {
                const due = data.previews?.[button.rating]?.due;
                const active = userFsrsRating === button.rating;
                return (
                  <button
                    key={button.rating}
                    type="button"
                    onClick={() => setUserFsrsRating(button.rating)}
                    className={cn(
                      "rounded-lg border px-3 py-3 text-center transition hover:bg-subtle",
                      active ? "border-accent ring-1 ring-accent/30 bg-accent-soft/30" : "border-border bg-surface",
                    )}
                  >
                    <div className="text-sm font-semibold">{button.label}</div>
                    <div className="mt-1 font-mono text-[11px] text-muted">{due ? formatInterval(due) : "-"}</div>
                    <div className="mt-1 text-[11px] text-muted leading-tight">{button.hint}</div>
                  </button>
                );
              })}
            </div>

            {error && <p className="mt-3 text-sm text-danger">{error}</p>}

            <button
              type="button"
              disabled={submitting}
              onClick={submitRating}
              className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-card hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "..." : "Submit"}
            </button>
          </Surface>
        </>
      )}

      {stage === "result" && result && (
        <Surface className="p-8 text-center">
          <h2 className="text-xl font-semibold">Done</h2>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Summary label="Rating" value={RATING_BUTTONS.find((b) => b.rating === userFsrsRating)?.label ?? userFsrsRating} />
            <Summary label="Next review" value={formatInterval(result.nextDue)} />
            <Summary label="Remaining today" value={result.queue?.dueCount ?? 0} />
          </div>
          <button
            type="button"
            onClick={loadNext}
            className="mt-6 inline-flex rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-card hover:opacity-90"
          >
            Next
          </button>
        </Surface>
      )}

      <NotesDrawer
        open={notesOpen}
        onClose={() => setNotesOpen(false)}
        notes={notes}
        setNotes={setNotes}
        editing={editingNotes}
        setEditing={setEditingNotes}
      />
    </div>
  );
}

function ReviewHeader({
  problem, cardTotal, dueCount, notesOpen, onToggleNotes, hasNotes,
}: {
  problem: Problem; cardTotal: number; dueCount: number;
  notesOpen: boolean; onToggleNotes: () => void; hasNotes: boolean;
}) {
  return (
    <header className="flex flex-wrap items-center gap-2">
      <DifficultyPill difficulty={problem.difficulty} />
      <FsrsStatePill state={problem.fsrsState} />
      {problem.topicTags.slice(0, 3).map((tag) => (
        <span key={tag} className="text-xs text-muted">#{tag}</span>
      ))}
      <span className="text-xs text-muted">· {cardTotal} cards</span>
      <button
        type="button"
        onClick={onToggleNotes}
        className={cn(
          "ml-auto rounded-md border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide transition",
          notesOpen ? "border-accent text-accent bg-accent-soft/20" : "border-border text-muted hover:border-fg/30",
          hasNotes && !notesOpen && "text-accent border-accent/40",
        )}
      >
        Notes
      </button>
      <span className="text-xs uppercase tracking-wider text-muted">{dueCount} due</span>
    </header>
  );
}

function NotesDrawer({
  open, onClose, notes, setNotes, editing, setEditing,
}: {
  open: boolean; onClose: () => void;
  notes: string; setNotes: (v: string) => void;
  editing: boolean; setEditing: (v: boolean) => void;
}) {
  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/30 transition-opacity duration-300",
          open ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        onClick={onClose}
      />
      <div
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50 max-h-[60vh] overflow-auto rounded-t-xl border-t border-border bg-surface shadow-2xl transition-transform duration-300 ease-in-out",
          open ? "translate-y-0" : "translate-y-full",
        )}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-surface px-5 py-3 rounded-t-xl">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Notes</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setEditing(!editing)}
              className="text-[11px] text-muted hover:text-fg transition-colors"
            >
              {editing ? "preview" : "edit"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-[11px] text-muted hover:text-fg transition-colors"
            >
              close
            </button>
          </div>
        </div>
        <div className="p-5">
          {editing ? (
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={10}
              className="min-h-[30vh] w-full resize-y rounded-lg border border-border bg-subtle p-3 font-mono text-sm leading-relaxed placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/40"
              placeholder="Markdown notes — what to remember, what changed, open questions..."
              autoFocus
            />
          ) : notes.trim() ? (
            <div className="cursor-text" onClick={() => setEditing(true)}>
              <Markdown>{notes}</Markdown>
            </div>
          ) : (
            <p className="text-sm text-muted cursor-pointer" onClick={() => setEditing(true)}>
              Click to start writing...
            </p>
          )}
        </div>
      </div>
    </>
  );
}

function Summary({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-subtle px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function SubmissionDetails({ submissions }: { submissions: Submission[] }) {
  if (submissions.length === 0) {
    return (
      <details className="rounded-lg border border-border bg-subtle/50">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted">
          Submissions
        </summary>
        <p className="border-t border-border px-3 py-3 text-sm text-muted">No submissions captured.</p>
      </details>
    );
  }

  return (
    <details className="rounded-lg border border-border bg-subtle/50">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted">
        Submissions · {submissions.length}
      </summary>
      <div className="space-y-3 border-t border-border p-3">
        {submissions.map((s) => {
          const passed = s.status === "Accepted";
          return (
            <div key={s.id} className="overflow-hidden rounded-md border border-border bg-surface">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-subtle/50 px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={passed ? "success" : "danger"}>{s.status}</Pill>
                  <span className="font-mono text-muted">{s.language}</span>
                  {s.runtimeMs != null && <span className="text-muted">{s.runtimeMs} ms</span>}
                  {s.memoryKb != null && <span className="text-muted">{(s.memoryKb / 1024).toFixed(1)} MB</span>}
                </div>
                <span className="text-muted">{new Date(s.submittedAt).toLocaleString()}</span>
              </div>
              {s.errorMessage && (
                <div className="border-b border-border bg-danger/5 px-3 py-2 text-xs text-danger">
                  {s.errorMessage}
                </div>
              )}
              <pre className="max-h-56 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed">
                {s.code}
              </pre>
            </div>
          );
        })}
      </div>
    </details>
  );
}

function stripConstraints(markdown: string | null | undefined) {
  if (!markdown) return "";
  const idx = markdown.search(/\n#+\s*Constraints|\nConstraints:/i);
  if (idx > 0) return markdown.slice(0, idx).trim();
  return markdown;
}

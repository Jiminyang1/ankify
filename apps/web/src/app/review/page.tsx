"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
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
type WorkspaceTab = "cards" | "submissions" | "notes";

const MIN_CONTEXT_SPLIT = 35;
const MAX_CONTEXT_SPLIT = 70;
const MIN_CONTEXT_WIDTH = 360;
const MIN_CARD_WIDTH = 360;

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
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("cards");
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null);
  const [cardIdx, setCardIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [result, setResult] = useState<RateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [splitPercent, setSplitPercent] = useState(58);
  const reviewLayoutRef = useRef<HTMLDivElement | null>(null);

  const loadNext = useCallback(async () => {
    setStage("loading");
    setUserFsrsRating(3);
    setNotes("");
    setEditingNotes(false);
    setWorkspaceTab("cards");
    setSelectedSubmissionId(null);
    setCardIdx(0);
    setFlipped(false);
    setResult(null);
    setError(null);
    const res = await fetch("/api/review/next", { cache: "no-store" });
    if (res.redirected && new URL(res.url).pathname === "/login") {
      window.location.assign("/login?next=/review");
      return;
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok || !contentType.includes("application/json")) {
      setError("Review session expired. Please log in again.");
      window.location.assign("/login?next=/review");
      return;
    }
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

  const getSplitBounds = useCallback(() => {
    const layout = reviewLayoutRef.current;
    if (!layout) return { min: MIN_CONTEXT_SPLIT, max: MAX_CONTEXT_SPLIT };
    const rect = layout.getBoundingClientRect();
    if (rect.width <= 0) return { min: MIN_CONTEXT_SPLIT, max: MAX_CONTEXT_SPLIT };

    const minByContextWidth = (MIN_CONTEXT_WIDTH / rect.width) * 100;
    const maxByCardWidth = 100 - (MIN_CARD_WIDTH / rect.width) * 100;
    const min = Math.max(MIN_CONTEXT_SPLIT, minByContextWidth);
    const max = Math.max(min, Math.min(MAX_CONTEXT_SPLIT, maxByCardWidth));
    return { min, max };
  }, []);

  const updateSplit = useCallback((clientX: number) => {
    const layout = reviewLayoutRef.current;
    if (!layout) return;
    const rect = layout.getBoundingClientRect();
    if (rect.width <= 0) return;
    const next = ((clientX - rect.left) / rect.width) * 100;
    const bounds = getSplitBounds();
    setSplitPercent(clamp(next, bounds.min, bounds.max));
  }, [getSplitBounds]);

  const startResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    updateSplit(event.clientX);

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: PointerEvent) => updateSplit(moveEvent.clientX);
    const stopResize = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize, { once: true });
    window.addEventListener("pointercancel", stopResize, { once: true });
  }, [updateSplit]);

  const resizeWithKeyboard = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? -4 : 4;
    const bounds = getSplitBounds();
    setSplitPercent((current) => clamp(current + delta, bounds.min, bounds.max));
  }, [getSplitBounds]);

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
        notesOpen={workspaceTab === "notes"}
        onToggleNotes={() => setWorkspaceTab((tab) => (tab === "notes" ? "cards" : "notes"))}
        hasNotes={notes.trim().length > 0}
      />

      {stage === "review" && (
        <>
          {/* Main: left problem / right flashcard */}
          <div
            ref={reviewLayoutRef}
            className="flex flex-col gap-4 lg:h-[calc(100vh_-_150px)] lg:flex-row lg:gap-0"
            style={{ "--context-pane-width": `${splitPercent}%` } as CSSProperties}
          >
            {/* Left: Problem statement */}
            <div className="min-w-0 lg:min-w-[360px] lg:basis-[var(--context-pane-width)] lg:shrink-0">
              <StatementPanel problem={problem} />
            </div>

            <div
              role="separator"
              aria-label="Resize review panels"
              aria-orientation="vertical"
              tabIndex={0}
              onPointerDown={startResize}
              onKeyDown={resizeWithKeyboard}
              className="group hidden w-5 shrink-0 cursor-col-resize items-stretch justify-center px-2 outline-none lg:flex"
            >
              <div className="my-1 w-px rounded-full bg-border transition group-hover:bg-accent group-focus-visible:bg-accent" />
            </div>

            {/* Right: review workspace */}
            <div className="min-h-[620px] min-w-0 lg:min-h-0 lg:flex-1">
              <WorkspacePanel
                activeTab={workspaceTab}
                onTabChange={setWorkspaceTab}
                cards={cards}
                currentCard={currentCard}
                cardIdx={cardIdx}
                setCardIdx={setCardIdx}
                flipped={flipped}
                setFlipped={setFlipped}
                submissions={submissions}
                selectedSubmissionId={selectedSubmissionId}
                onSelectSubmission={setSelectedSubmissionId}
                notes={notes}
                setNotes={setNotes}
                editingNotes={editingNotes}
                setEditingNotes={setEditingNotes}
                previews={data.previews}
                userFsrsRating={userFsrsRating}
                setUserFsrsRating={setUserFsrsRating}
                error={error}
                submitting={submitting}
                onSubmitRating={submitRating}
                problemId={problem.id}
              />
            </div>
          </div>
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

function StatementPanel({ problem }: { problem: Problem }) {
  return (
    <Surface className="flex h-full min-h-[420px] flex-col overflow-hidden lg:min-h-0">
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Question statement</span>
          <span className="truncate text-xs text-muted">{problem.title}</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        {problem.descriptionMd ? (
          <Markdown className="[&_code]:break-words">{stripConstraints(problem.descriptionMd)}</Markdown>
        ) : (
          <p className="text-sm text-muted">No problem description captured.</p>
        )}
      </div>
    </Surface>
  );
}

function WorkspacePanel({
  activeTab,
  onTabChange,
  cards,
  currentCard,
  cardIdx,
  setCardIdx,
  flipped,
  setFlipped,
  submissions,
  selectedSubmissionId,
  onSelectSubmission,
  notes,
  setNotes,
  editingNotes,
  setEditingNotes,
  previews,
  userFsrsRating,
  setUserFsrsRating,
  error,
  submitting,
  onSubmitRating,
  problemId,
}: {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  cards: Card[];
  currentCard: Card | null;
  cardIdx: number;
  setCardIdx: Dispatch<SetStateAction<number>>;
  flipped: boolean;
  setFlipped: Dispatch<SetStateAction<boolean>>;
  submissions: Submission[];
  selectedSubmissionId: string | null;
  onSelectSubmission: (id: string) => void;
  notes: string;
  setNotes: (value: string) => void;
  editingNotes: boolean;
  setEditingNotes: (editing: boolean) => void;
  previews: ReviewPayload["previews"];
  userFsrsRating: FsrsRating;
  setUserFsrsRating: (rating: FsrsRating) => void;
  error: string | null;
  submitting: boolean;
  onSubmitRating: () => void;
  problemId: string;
}) {
  const tabs: { id: WorkspaceTab; label: string; count?: number }[] = [
    { id: "cards", label: "Cards", count: cards.length },
    { id: "submissions", label: "Submissions", count: submissions.length },
    { id: "notes", label: "Notes" },
  ];

  return (
    <Surface className="flex h-full min-h-[620px] flex-col overflow-hidden lg:min-h-0">
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Review workspace</span>
          <span className="text-xs text-muted">Cards · Code · Notes</span>
        </div>

        <div className="mt-3 flex rounded-lg bg-subtle p-1">
          {tabs.map((tab) => (
            <ReviewTabButton
              key={tab.id}
              label={tab.label}
              count={tab.count}
              active={activeTab === tab.id}
              onClick={() => onTabChange(tab.id)}
            />
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "cards" && (
          <CardReviewPanel
            cards={cards}
            currentCard={currentCard}
            cardIdx={cardIdx}
            setCardIdx={setCardIdx}
            flipped={flipped}
            setFlipped={setFlipped}
            previews={previews}
            userFsrsRating={userFsrsRating}
            setUserFsrsRating={setUserFsrsRating}
            error={error}
            submitting={submitting}
            onSubmitRating={onSubmitRating}
            problemId={problemId}
          />
        )}

        {activeTab === "submissions" && (
          <SubmissionExplorer
            submissions={submissions}
            selectedSubmissionId={selectedSubmissionId}
            onSelectSubmission={onSelectSubmission}
          />
        )}

        {activeTab === "notes" && (
          <NotesEditor
            notes={notes}
            setNotes={setNotes}
            editing={editingNotes}
            setEditing={setEditingNotes}
          />
        )}
      </div>
    </Surface>
  );
}

function ReviewTabButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={count != null ? `${label} ${count}` : label}
      onClick={onClick}
      className={cn(
        "min-w-0 flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition",
        active ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg",
      )}
    >
      <span className="truncate">{label}</span>
      {count != null && <span className="ml-1 text-[10px] text-muted">{count}</span>}
    </button>
  );
}

function CardReviewPanel({
  cards,
  currentCard,
  cardIdx,
  setCardIdx,
  flipped,
  setFlipped,
  previews,
  userFsrsRating,
  setUserFsrsRating,
  error,
  submitting,
  onSubmitRating,
  problemId,
}: {
  cards: Card[];
  currentCard: Card | null;
  cardIdx: number;
  setCardIdx: Dispatch<SetStateAction<number>>;
  flipped: boolean;
  setFlipped: Dispatch<SetStateAction<boolean>>;
  previews: ReviewPayload["previews"];
  userFsrsRating: FsrsRating;
  setUserFsrsRating: (rating: FsrsRating) => void;
  error: string | null;
  submitting: boolean;
  onSubmitRating: () => void;
  problemId: string;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
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
          {cards.length > 0 ? `${cardIdx + 1} / ${cards.length}` : "0 / 0"}
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

      <div className="min-h-0 flex-1 overflow-hidden" style={{ perspective: "800px" }}>
        {currentCard ? (
          <div
            className="h-full cursor-pointer overflow-hidden"
            onClick={() => setFlipped((f) => !f)}
          >
            <div
              className="h-full transition-transform duration-500 ease-in-out"
              style={{ transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}
            >
              {!flipped ? (
                <div className="h-full flex flex-col">
                  <div className="flex-1 overflow-auto p-4 sm:p-5">
                    <div className="flex min-h-full flex-col rounded-lg bg-subtle/40 px-5 py-6 sm:px-7">
                      <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted">Question</div>
                      <div className="flex flex-1 items-center justify-center py-8">
                        <Markdown className="max-w-[34rem] text-center break-words [&_code]:break-words [&_li]:text-base [&_li]:leading-relaxed [&_p]:text-base [&_p]:leading-relaxed">
                          {currentCard.question}
                        </Markdown>
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 border-t border-border px-4 py-2 text-center">
                    <span className="text-[10px] text-muted">Tap to reveal answer</span>
                  </div>
                </div>
              ) : (
                <div
                  className="h-full flex flex-col"
                  style={{ transform: "rotateY(180deg)" }}
                >
                  <div className="flex-1 overflow-auto p-4 sm:p-5">
                    <div className="flex min-h-full flex-col rounded-lg border border-success/30 bg-success/10 px-5 py-5 sm:px-7 sm:py-6">
                      <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-success">Answer</div>
                      <div className="flex flex-1 items-center py-6">
                        <Markdown className="w-full break-words font-medium [&_code]:break-words [&_li]:text-base [&_li]:leading-8 [&_p]:text-base [&_p]:leading-8">
                          {currentCard.answer}
                        </Markdown>
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 border-t border-border px-4 py-2 text-center">
                    <span className="text-[10px] text-muted">Tap to see question</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-5 text-center">
            <div>
              <p className="text-sm text-muted">No cards for this problem yet.</p>
              <Link
                href={`/problems/${problemId}`}
                className="mt-2 inline-block text-xs text-accent hover:underline"
              >
                Add a card →
              </Link>
            </div>
          </div>
        )}
      </div>

      <CompactRating
        previews={previews}
        userFsrsRating={userFsrsRating}
        setUserFsrsRating={setUserFsrsRating}
        error={error}
        submitting={submitting}
        onSubmitRating={onSubmitRating}
      />
    </div>
  );
}

function CompactRating({
  previews,
  userFsrsRating,
  setUserFsrsRating,
  error,
  submitting,
  onSubmitRating,
}: {
  previews: ReviewPayload["previews"];
  userFsrsRating: FsrsRating;
  setUserFsrsRating: (rating: FsrsRating) => void;
  error: string | null;
  submitting: boolean;
  onSubmitRating: () => void;
}) {
  return (
    <div className="shrink-0 border-t border-border bg-surface/70 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted">Rating</span>
        <button
          type="button"
          disabled={submitting}
          onClick={onSubmitRating}
          className="inline-flex h-7 items-center justify-center rounded-md bg-accent px-3 text-xs font-semibold text-white shadow-card hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "..." : "Submit"}
        </button>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {RATING_BUTTONS.map((button) => {
          const due = previews?.[button.rating]?.due;
          const active = userFsrsRating === button.rating;
          return (
            <button
              key={button.rating}
              type="button"
              title={button.hint}
              aria-label={`${button.label}: ${button.hint}`}
              onClick={() => setUserFsrsRating(button.rating)}
              className={cn(
                "rounded-md border px-2 py-1.5 text-center transition hover:bg-subtle",
                active ? "border-accent ring-1 ring-accent/30 bg-accent-soft/30" : "border-border bg-surface",
              )}
            >
              <div className="text-xs font-semibold leading-tight">{button.label}</div>
              <div className="mt-0.5 font-mono text-[10px] leading-tight text-muted">{due ? formatInterval(due) : "-"}</div>
            </button>
          );
        })}
      </div>

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}

function NotesEditor({
  notes,
  setNotes,
  editing,
  setEditing,
}: {
  notes: string;
  setNotes: (value: string) => void;
  editing: boolean;
  setEditing: (editing: boolean) => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border px-5 py-3">
        <button
          type="button"
          onClick={() => setEditing(!editing)}
          className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-muted transition hover:border-fg/30 hover:text-fg"
        >
          {editing ? "Preview" : "Edit"}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-5">
        {editing ? (
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="h-full min-h-[320px] w-full resize-none rounded-lg border border-border bg-subtle p-3 font-mono text-sm leading-relaxed placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/40"
            placeholder="Markdown notes — what to remember, what changed, open questions..."
            autoFocus
          />
        ) : notes.trim() ? (
          <div className="min-h-full cursor-text" onClick={() => setEditing(true)}>
            <Markdown>{notes}</Markdown>
          </div>
        ) : (
          <p className="cursor-pointer text-sm text-muted" onClick={() => setEditing(true)}>
            Click to start writing...
          </p>
        )}
      </div>
    </div>
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

function SubmissionExplorer({
  submissions,
  selectedSubmissionId,
  onSelectSubmission,
}: {
  submissions: Submission[];
  selectedSubmissionId: string | null;
  onSelectSubmission: (id: string) => void;
}) {
  if (submissions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-5 text-center">
        <p className="text-sm text-muted">No submissions captured.</p>
      </div>
    );
  }

  const selectedSubmission = submissions.find((submission) => submission.id === selectedSubmissionId) ?? submissions[0];
  if (!selectedSubmission) return null;

  const passed = selectedSubmission.status === "Accepted";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 overflow-x-auto border-b border-border p-3">
        <div className="flex gap-2">
          {submissions.map((submission, index) => {
            const active = submission.id === selectedSubmission.id;
            return (
              <button
                key={submission.id}
                type="button"
                onClick={() => onSelectSubmission(submission.id)}
                className={cn(
                  "min-w-[180px] shrink-0 rounded-lg border px-3 py-2 text-left transition",
                  active ? "border-accent bg-accent-soft/25" : "border-border bg-surface hover:bg-subtle",
                )}
              >
                <div className="flex items-center gap-2">
                  <Pill tone={submission.status === "Accepted" ? "success" : "danger"}>
                    {submission.status}
                  </Pill>
                  <span className="font-mono text-xs text-muted">#{submissions.length - index}</span>
                </div>
                <div className="mt-1 truncate text-xs text-muted">
                  {submission.language}
                  {submission.runtimeMs != null && ` · ${submission.runtimeMs} ms`}
                  {submission.memoryKb != null && ` · ${formatMemory(submission.memoryKb)}`}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-4">
        <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface">
          <div className="shrink-0 border-b border-border bg-subtle/50 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Pill tone={passed ? "success" : "danger"}>{selectedSubmission.status}</Pill>
              <span className="font-mono text-muted">{selectedSubmission.language}</span>
              {selectedSubmission.runtimeMs != null && <span className="text-muted">{selectedSubmission.runtimeMs} ms</span>}
              {selectedSubmission.memoryKb != null && <span className="text-muted">{formatMemory(selectedSubmission.memoryKb)}</span>}
              <span className="ml-auto text-muted">{formatSubmissionDate(selectedSubmission.submittedAt)}</span>
            </div>
          </div>

          {(selectedSubmission.errorMessage || selectedSubmission.failedTestcase || selectedSubmission.expectedOutput || selectedSubmission.actualOutput) && (
            <div className="shrink-0 space-y-2 border-b border-border bg-danger/5 px-4 py-3 text-xs">
              <SubmissionDetail label="Error" value={selectedSubmission.errorMessage} />
              <SubmissionDetail label="Failed testcase" value={selectedSubmission.failedTestcase} />
              <SubmissionDetail label="Expected" value={selectedSubmission.expectedOutput} />
              <SubmissionDetail label="Actual" value={selectedSubmission.actualOutput} />
            </div>
          )}

          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre px-4 py-3 font-mono text-xs leading-6">
            {selectedSubmission.code}
          </pre>
        </div>
      </div>
    </div>
  );
}

function SubmissionDetail({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <span className="font-medium uppercase tracking-wide text-muted">{label}</span>
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-fg">{value}</pre>
    </div>
  );
}

function formatMemory(memoryKb: number) {
  return `${(memoryKb / 1024).toFixed(1)} MB`;
}

function formatSubmissionDate(value: Submission["submittedAt"]) {
  if (!value) return "No timestamp";
  return new Date(value).toLocaleString();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function stripConstraints(markdown: string | null | undefined) {
  if (!markdown) return "";
  const idx = markdown.search(/\n#+\s*Constraints|\nConstraints:/i);
  if (idx > 0) return markdown.slice(0, idx).trim();
  return markdown;
}

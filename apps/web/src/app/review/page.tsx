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
import type { FsrsRating, QuizAnswer, QuizItem } from "@ankify/core";
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
type WorkspaceTab = "quiz" | "cards" | "submissions" | "notes";
type QuizSessionPayload = {
  id: string;
  problemId: string;
  status: "active" | "completed" | "archived";
  itemsJson: QuizItem[];
  answersJson: QuizAnswer[];
  score: number | null;
  createdAt: string;
  updatedAt: string | null;
  completedAt: string | null;
};

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
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("quiz");
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
    setWorkspaceTab("quiz");
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

  const handleQuizCardSaved = useCallback((card: Card) => {
    setData((current) => {
      if (!current?.problem || current.problem.id !== card.problemId) return current;
      if (current.problem.cards.some((existing) => existing.id === card.id)) return current;
      return {
        ...current,
        problem: {
          ...current.problem,
          cards: [card, ...current.problem.cards],
        },
      };
    });
  }, []);

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
      />

      {stage === "review" && (
        <>
          {/* Main: left problem / right flashcard */}
          <div
            ref={reviewLayoutRef}
            className="flex flex-col gap-4 lg:h-[calc(100vh_-_150px)] lg:flex-row lg:gap-0"
            style={{ "--context-pane-width": `${splitPercent}%` } as CSSProperties}
          >
            {/* Left: Problem statement + rating (both problem-level) */}
            <div className="min-w-0 lg:min-w-[360px] lg:basis-[var(--context-pane-width)] lg:shrink-0">
              <StatementPanel
                problem={problem}
                previews={data.previews}
                userFsrsRating={userFsrsRating}
                setUserFsrsRating={setUserFsrsRating}
                error={error}
                submitting={submitting}
                onSubmitRating={submitRating}
              />
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
                problemId={problem.id}
                onQuizCardSaved={handleQuizCardSaved}
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
  problem, cardTotal, dueCount,
}: {
  problem: Problem; cardTotal: number; dueCount: number;
}) {
  const [tagsHidden, setTagsHidden] = useState(() => {
    try { return localStorage.getItem("review-tags-hidden") === "1"; } catch { return false; }
  });

  function toggleTags() {
    setTagsHidden((v) => {
      const next = !v;
      try { localStorage.setItem("review-tags-hidden", next ? "1" : "0"); } catch {}
      return next;
    });
  }

  return (
    <header className="flex flex-wrap items-center gap-2">
      <DifficultyPill difficulty={problem.difficulty} />
      <FsrsStatePill state={problem.fsrsState} />
      {!tagsHidden && problem.topicTags.slice(0, 3).map((tag) => (
        <span key={tag} className="text-xs text-muted">#{tag}</span>
      ))}
      <span className="text-xs text-muted">· {cardTotal} cards</span>
      <button
        type="button"
        onClick={toggleTags}
        className="ml-auto text-[11px] text-muted hover:text-fg transition-colors"
        title={tagsHidden ? "Show topic tags" : "Hide topic tags"}
      >
        {tagsHidden ? "show tags" : "hide tags"}
      </button>
      <span className="text-xs uppercase tracking-wider text-muted">{dueCount} due</span>
    </header>
  );
}

function StatementPanel({
  problem,
  previews,
  userFsrsRating,
  setUserFsrsRating,
  error,
  submitting,
  onSubmitRating,
}: {
  problem: Problem;
  previews: ReviewPayload["previews"];
  userFsrsRating: FsrsRating;
  setUserFsrsRating: (rating: FsrsRating) => void;
  error: string | null;
  submitting: boolean;
  onSubmitRating: () => void;
}) {
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

      {/* Rating is problem-level — lives alongside the problem statement */}
      <CompactRating
        previews={previews}
        userFsrsRating={userFsrsRating}
        setUserFsrsRating={setUserFsrsRating}
        error={error}
        submitting={submitting}
        onSubmitRating={onSubmitRating}
      />
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
  problemId,
  onQuizCardSaved,
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
  problemId: string;
  onQuizCardSaved: (card: Card) => void;
}) {
  const tabs: { id: WorkspaceTab; label: string; count?: number }[] = [
    { id: "quiz", label: "Quiz" },
    { id: "cards", label: "Cards", count: cards.length },
    { id: "submissions", label: "Submissions", count: submissions.length },
    { id: "notes", label: "Notes" },
  ];

  return (
    <Surface className="flex h-full min-h-[620px] flex-col overflow-hidden lg:min-h-0">
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Review workspace</span>
          <span className="text-xs text-muted">Quiz · Cards · Code · Notes</span>
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
        <div className={cn("h-full", activeTab !== "quiz" && "hidden")}>
          <QuizPanel problemId={problemId} onCardSaved={onQuizCardSaved} />
        </div>

        <div className={cn("h-full", activeTab !== "cards" && "hidden")}>
          <CardReviewPanel
            cards={cards}
            currentCard={currentCard}
            cardIdx={cardIdx}
            setCardIdx={setCardIdx}
            flipped={flipped}
            setFlipped={setFlipped}
            problemId={problemId}
          />
        </div>

        <div className={cn("h-full", activeTab !== "submissions" && "hidden")}>
          <SubmissionExplorer
            submissions={submissions}
            selectedSubmissionId={selectedSubmissionId}
            onSelectSubmission={onSelectSubmission}
          />
        </div>

        <div className={cn("h-full", activeTab !== "notes" && "hidden")}>
          <NotesEditor
            notes={notes}
            setNotes={setNotes}
            problemId={problemId}
          />
        </div>
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

function QuizPanel({ problemId, onCardSaved }: { problemId: string; onCardSaved: (card: Card) => void }) {
  const [session, setSession] = useState<QuizSessionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [submittingItem, setSubmittingItem] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [feedback, setFeedback] = useState<{ item: QuizItem; answer: QuizAnswer } | null>(null);
  const [savedItemIds, setSavedItemIds] = useState<Set<string>>(new Set());
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSession = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFeedback(null);
    setSavedItemIds(new Set());
    try {
      const res = await fetch(`/api/problems/${problemId}/quiz`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as { session?: QuizSessionPayload | null; error?: string } | null;
      if (!res.ok) throw new Error(json?.error ?? "Failed to load quiz");
      const nextSession = json?.session ?? null;
      setSession(nextSession);
      setCurrentIndex(getFirstUnansweredIndex(nextSession));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load quiz");
    } finally {
      setLoading(false);
    }
  }, [problemId]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  async function generateQuiz(action: "generate" | "regenerate") {
    setGenerating(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch(`/api/problems/${problemId}/quiz`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = (await res.json().catch(() => null)) as { session?: QuizSessionPayload; error?: string } | null;
      if (!res.ok || !json?.session) throw new Error(json?.error ?? "Failed to generate quiz");
      setSession(json.session);
      setSavedItemIds(new Set());
      setCurrentIndex(getFirstUnansweredIndex(json.session));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate quiz");
    } finally {
      setGenerating(false);
    }
  }

  async function submitAnswer(item: QuizItem, selectedIndex: number) {
    if (!session || feedback || submittingItem) return;
    setSubmittingItem(true);
    setError(null);
    try {
      const res = await fetch(`/api/problems/${problemId}/quiz/${session.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId: item.id, selectedIndex }),
      });
      const json = (await res.json().catch(() => null)) as {
        session?: QuizSessionPayload;
        item?: QuizItem;
        answer?: QuizAnswer;
        error?: string;
      } | null;
      if (!res.ok || !json?.session || !json.item || !json.answer) {
        throw new Error(json?.error ?? "Failed to submit answer");
      }
      setSession(json.session);
      setFeedback({ item: json.item, answer: json.answer });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit answer");
    } finally {
      setSubmittingItem(false);
    }
  }

  async function saveAsCard(item: QuizItem) {
    if (!session) return;
    setSavingItemId(item.id);
    setError(null);
    try {
      const res = await fetch(`/api/problems/${problemId}/quiz/${session.id}/save-card`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId: item.id }),
      });
      const json = (await res.json().catch(() => null)) as { card?: Card; error?: string } | null;
      if (!res.ok) throw new Error(json?.error ?? "Failed to save card");
      if (json?.card) onCardSaved(json.card);
      setSavedItemIds((prev) => new Set(prev).add(item.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save card");
    } finally {
      setSavingItemId(null);
    }
  }

  function goNext() {
    if (!session) return;
    setFeedback(null);
    setCurrentIndex(getFirstUnansweredIndex(session));
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center p-5 text-sm text-muted">Loading quiz...</div>;
  }

  if (generating && !session) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 text-center shadow-card">
          <div className="mx-auto h-1.5 w-32 overflow-hidden rounded-full bg-subtle">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-accent/80" />
          </div>
          <h3 className="mt-4 text-sm font-semibold">Pending quiz generation</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            The request is still running. You can review Cards, Submissions, or Notes and come back here.
          </p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 text-center shadow-card">
          <div className="mx-auto inline-flex rounded-full border border-accent/25 bg-accent-soft px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-accent">
            Quiz
          </div>
          <h3 className="mt-3 text-sm font-semibold">No quiz for this review yet</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Generate 5 focused questions from the statement, your submissions, notes, and saved cards.
          </p>
          <button
            type="button"
            disabled={generating}
            onClick={() => void generateQuiz("generate")}
            className="mt-4 rounded-md bg-accent px-4 py-2 text-xs font-semibold text-white shadow-card hover:opacity-90 disabled:opacity-50"
          >
            {generating ? "Generating..." : "Generate 5-question quiz"}
          </button>
          {error && <p className="mt-3 text-xs text-danger">{error}</p>}
        </div>
      </div>
    );
  }

  if (session.status === "completed" && !feedback) {
    const suggested = getSuggestedRating(session.score ?? 0);
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 border-b border-border px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div>
              <div className="text-sm font-semibold">Quiz complete</div>
              <div className="mt-0.5 text-xs text-muted">
                Score {session.score ?? 0} / {session.itemsJson.length} · Suggested: {suggested.label}
              </div>
            </div>
            <button
              type="button"
              disabled={generating}
              onClick={() => void generateQuiz("regenerate")}
              className="ml-auto rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted hover:bg-subtle hover:text-fg disabled:opacity-50"
            >
              {generating ? "Regenerating..." : "Regenerate"}
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
          {session.itemsJson.map((item, index) => {
            const answer = session.answersJson.find((a) => a.itemId === item.id);
            return (
              <QuizResultItem
                key={item.id}
                index={index}
                item={item}
                answer={answer ?? null}
                saved={savedItemIds.has(item.id)}
                saving={savingItemId === item.id}
                onSave={() => void saveAsCard(item)}
              />
            );
          })}
        </div>
      </div>
    );
  }

  const item = session.itemsJson[currentIndex] ?? session.itemsJson[0];
  if (!item) {
    return (
      <div className="flex h-full items-center justify-center p-5 text-center">
        <div>
          <p className="text-sm text-muted">This quiz has no questions.</p>
          <button
            type="button"
            disabled={generating}
            onClick={() => void generateQuiz("regenerate")}
            className="mt-3 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white shadow-card hover:opacity-90 disabled:opacity-50"
          >
            {generating ? "Regenerating..." : "Regenerate quiz"}
          </button>
        </div>
      </div>
    );
  }
  const progress = session.answersJson.length + (feedback ? 0 : 1);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted">
              Quiz · Question {Math.min(progress, session.itemsJson.length)} / {session.itemsJson.length}
            </div>
            <div className="mt-1 h-1.5 w-32 overflow-hidden rounded-full bg-subtle">
              <div
                className="h-full rounded-full bg-accent/80 transition-all"
                style={{ width: `${Math.max(8, (session.answersJson.length / session.itemsJson.length) * 100)}%` }}
              />
            </div>
          </div>
          <button
            type="button"
            disabled={generating}
            onClick={() => void generateQuiz("regenerate")}
            className="rounded-md px-2 py-1 text-xs text-muted transition hover:bg-subtle hover:text-fg disabled:opacity-50"
          >
            Regenerate
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-5">
        <div className="mx-auto max-w-2xl">
          <div className="rounded-lg border border-border bg-subtle/40 px-4 py-4 sm:px-5">
            <Markdown className="text-base font-medium leading-relaxed [&_p]:text-base">{item.question}</Markdown>
          </div>

          <div className="mt-4 space-y-2">
            {item.choices.map((choice, index) => {
              const wasSelected = feedback?.answer.selectedIndex === index;
              const isCorrect = feedback && item.answerIndex === index;
              return (
                <button
                  key={index}
                  type="button"
                  disabled={!!feedback || submittingItem}
                  onClick={() => void submitAnswer(item, index)}
                  className={cn(
                    "group w-full rounded-lg border px-4 py-3 text-left transition",
                    "border-border bg-surface hover:border-accent/40 hover:bg-subtle/70 disabled:cursor-default",
                    feedback && isCorrect ? "border-success/50 bg-success/10" : "",
                    feedback && wasSelected && !isCorrect ? "border-danger/50 bg-danger/10" : "",
                  )}
                >
                  <div className="flex gap-3">
                    <span className={cn(
                      "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] font-semibold",
                      "border-border text-muted group-hover:border-accent/40 group-hover:text-accent",
                      feedback && isCorrect ? "border-success/40 text-success" : "",
                      feedback && wasSelected && !isCorrect ? "border-danger/40 text-danger" : "",
                    )}>
                      {String.fromCharCode(65 + index)}
                    </span>
                    <Markdown className="min-w-0 flex-1 text-sm">{choice}</Markdown>
                  </div>
                </button>
              );
            })}
          </div>

          {feedback ? (
            <div className={cn("mt-5 rounded-lg border p-4", feedback.answer.correct ? "border-success/40 bg-success/10" : "border-danger/40 bg-danger/10")}>
              <div className={cn("text-sm font-semibold", feedback.answer.correct ? "text-success" : "text-danger")}>
                {feedback.answer.correct ? "Correct" : "Not quite"}
              </div>
              <Markdown className="mt-2 text-sm">{item.explanation}</Markdown>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={savedItemIds.has(item.id) || savingItemId === item.id}
                  onClick={() => void saveAsCard(item)}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-subtle disabled:opacity-50"
                >
                  {savedItemIds.has(item.id) ? "Saved" : savingItemId === item.id ? "Saving..." : "Save as card"}
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white shadow-card hover:opacity-90"
                >
                  {session.status === "completed" ? "View results" : "Next question"}
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted">
              {submittingItem ? "Checking answer..." : "Click an option to answer."}
            </p>
          )}

          {error && <p className="mt-3 text-xs text-danger">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function QuizResultItem({
  index,
  item,
  answer,
  saved,
  saving,
  onSave,
}: {
  index: number;
  item: QuizItem;
  answer: QuizAnswer | null;
  saved: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  const correctChoice = item.choices[item.answerIndex] ?? "";
  const selectedChoice = answer ? item.choices[answer.selectedIndex] : null;
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>Question {index + 1}</span>
        {answer && (
          <Pill tone={answer.correct ? "success" : "danger"}>
            {answer.correct ? "Correct" : "Incorrect"}
          </Pill>
        )}
        <span className="ml-auto">{item.source}</span>
      </div>
      <Markdown className="mt-2 text-sm font-medium">{item.question}</Markdown>
      {selectedChoice && (
        <div className="mt-3 text-xs text-muted">
          Your answer: <span className="text-fg">{selectedChoice}</span>
        </div>
      )}
      <div className="mt-1 text-xs text-muted">
        Correct answer: <span className="text-fg">{correctChoice}</span>
      </div>
      <Markdown className="mt-3 text-sm">{item.explanation}</Markdown>
      <button
        type="button"
        disabled={saved || saving}
        onClick={onSave}
        className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-subtle disabled:opacity-50"
      >
        {saved ? "Saved" : saving ? "Saving..." : "Save as card"}
      </button>
    </div>
  );
}

function getFirstUnansweredIndex(session: QuizSessionPayload | null) {
  if (!session) return 0;
  const idx = session.itemsJson.findIndex((item) => !session.answersJson.some((answer) => answer.itemId === item.id));
  return idx === -1 ? 0 : idx;
}

function getSuggestedRating(score: number): { rating: FsrsRating; label: string } {
  if (score <= 1) return { rating: 1, label: "Again" };
  if (score === 2) return { rating: 2, label: "Hard" };
  if (score <= 4) return { rating: 3, label: "Good" };
  return { rating: 4, label: "Easy" };
}

function CardReviewPanel({
  cards,
  currentCard,
  cardIdx,
  setCardIdx,
  flipped,
  setFlipped,
  problemId,
}: {
  cards: Card[];
  currentCard: Card | null;
  cardIdx: number;
  setCardIdx: Dispatch<SetStateAction<number>>;
  flipped: boolean;
  setFlipped: Dispatch<SetStateAction<boolean>>;
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
      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted">Rating</div>
      <div className="flex items-stretch gap-1.5">
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
                "flex-1 rounded-md border px-2 py-1.5 text-center transition hover:bg-subtle",
                active ? "border-accent ring-1 ring-accent/30 bg-accent-soft/30" : "border-border bg-surface",
              )}
            >
              <div className="text-xs font-semibold leading-tight">{button.label}</div>
              <div className="mt-0.5 text-[10px] leading-tight text-muted tabular-nums">{due ? formatInterval(due) : "-"}</div>
            </button>
          );
        })}

        <button
          type="button"
          disabled={submitting}
          onClick={onSubmitRating}
          className="rounded-md bg-accent px-4 text-xs font-semibold text-white shadow-card hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "…" : "Submit"}
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}

function NotesEditor({
  notes,
  setNotes,
  problemId,
}: {
  notes: string;
  setNotes: (value: string) => void;
  problemId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const savedRef = useRef(notes);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  async function persist(value: string) {
    if (value === savedRef.current) return;
    setStatus("saving");
    try {
      await fetch(`/api/problems/${problemId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: value }),
      });
      savedRef.current = value;
      setStatus("saved");
      setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1200);
    } catch {
      setStatus("idle");
    }
  }

  function scheduleSave(value: string) {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => persist(value), 600);
  }

  function flushSave() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    persist(notes);
  }

  const showTextarea = editing || !notes.trim();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <div className="relative flex h-full min-h-[20rem] flex-col rounded-lg border border-border bg-subtle p-3 transition-colors focus-within:border-accent/40">
          {showTextarea ? (
            <textarea
              ref={textareaRef}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                scheduleSave(e.target.value);
              }}
              onFocus={() => setEditing(true)}
              onBlur={() => {
                setEditing(false);
                flushSave();
              }}
              placeholder="Markdown notes — what to remember, what changed, open questions..."
              className="min-h-0 flex-1 w-full resize-none border-0 bg-transparent p-0 text-sm leading-relaxed placeholder:text-muted/50 focus:outline-none focus:ring-0"
              autoFocus={editing}
            />
          ) : (
            <div
              className="min-h-0 flex-1 cursor-text"
              onClick={() => setEditing(true)}
            >
              <Markdown>{notes}</Markdown>
            </div>
          )}
          <div
            className={cn(
              "pointer-events-none absolute right-3 top-3 text-[10px] text-muted tabular-nums transition-opacity",
              status === "idle" ? "opacity-0" : "opacity-70",
            )}
          >
            {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}
          </div>
        </div>
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
                  <span className="text-xs text-muted tabular-nums">#{submissions.length - index}</span>
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

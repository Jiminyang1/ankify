"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type {
  CardDto,
  ReviewPayloadDto,
  ReviewProblemDto,
  ReviewRateResponseDto,
  SubmissionDto,
} from "@ankify/contracts";
import type { FsrsRating } from "@ankify/core";
import { DifficultyPill, FsrsStatePill } from "@/components/ui/pill";
import { Surface } from "@/components/ui/surface";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { Markdown } from "@/components/ui/markdown";
import { useLanguage } from "@/components/LanguageProvider";
import { AgentSidebar } from "@/components/agent/agent-sidebar";
import {
  useAgentPageContext,
  useAgentShellControls,
  useEmbeddedAgentPanel,
} from "@/components/agent/agent-shell";
import { cn, formatInterval } from "@/lib/utils";
import { notifyReviewQueueUpdated } from "@/lib/review-queue-event";
import { ShortcutsHelp } from "./shortcuts-help";
import type { ReviewWorkspaceLayoutProps } from "./review-workspace-layout";
import type { QuizKeyInterface } from "./quiz-panel";

type RateResult = ReviewRateResponseDto;
type Stage = "loading" | "review" | "result" | "empty";
type WorkspaceTab = "quiz" | "cards" | "submissions" | "notes";
type WorkspaceResource = Exclude<WorkspaceTab, "quiz">;

type ReviewLabels = ReturnType<typeof useLanguage>["t"];

const LazyQuizPanel = dynamic(
  () => import("./quiz-panel").then((module) => module.QuizPanel),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    ),
  },
);

const LazySubmissionList = dynamic(
  () => import("@/components/submission-list").then((module) => module.SubmissionList),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    ),
  },
);

const LazyCardReviewPanel = dynamic(
  () => import("./card-review-panel").then((module) => module.CardReviewPanel),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    ),
  },
);

const LazyNotesEditor = dynamic(
  () => import("./notes-panel").then((module) => module.NotesEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    ),
  },
);

const ReviewWorkspaceLayout = dynamic<ReviewWorkspaceLayoutProps>(
  () => import("./review-workspace-layout").then((module) => module.ReviewWorkspaceLayout),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[420px] items-center justify-center lg:h-[calc(100dvh-85px)] lg:min-h-[620px]">
        <Spinner />
      </div>
    ),
  },
);

function getRatingButtons(t: ReviewLabels): { rating: FsrsRating; label: string; hint: string }[] {
  return [
    { rating: 1, label: t.rating.again, hint: t.rating.hints.again },
    { rating: 2, label: t.rating.hard, hint: t.rating.hints.hard },
    { rating: 3, label: t.rating.good, hint: t.rating.hints.good },
    { rating: 4, label: t.rating.easy, hint: t.rating.hints.easy },
  ];
}

function suggestedRatingForScore(score: number): FsrsRating {
  if (score <= 1) return 1;
  if (score === 2) return 2;
  if (score <= 4) return 3;
  return 4;
}

const REVIEW_TAGS_EVENT = "ankify:review-tags-visibility";
const DEFAULT_WORKSPACE_TAB: WorkspaceTab = "cards";
const LAST_WORKSPACE_TAB_KEY = "ankify.review.workspace-tab";

function subscribeReviewTags(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(REVIEW_TAGS_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(REVIEW_TAGS_EVENT, onStoreChange);
  };
}

function getReviewTagsSnapshot() {
  try {
    return localStorage.getItem("review-tags-hidden") === "1";
  } catch {
    return false;
  }
}

export default function ReviewPage({
  initialData,
  initialTargetId,
}: {
  initialData: ReviewPayloadDto;
  initialTargetId: string | null;
}) {
  const { language, t } = useLanguage();
  const [data, setData] = useState<ReviewPayloadDto | null>(initialData);
  const [stage, setStage] = useState<Stage>(
    initialData.problem ? "review" : "empty",
  );
  const [userFsrsRating, setUserFsrsRating] = useState<FsrsRating | null>(null);
  const [quizSuggestedRating, setQuizSuggestedRating] = useState<FsrsRating | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>(DEFAULT_WORKSPACE_TAB);
  const [cards, setCards] = useState<CardDto[] | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionDto[] | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState<
    Partial<Record<WorkspaceResource, boolean>>
  >({});
  const [workspaceErrors, setWorkspaceErrors] = useState<
    Partial<Record<WorkspaceResource, string>>
  >({});
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [cardIdx, setCardIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [result, setResult] = useState<RateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const quizKeysRef = useRef<QuizKeyInterface | null>(null);
  const ratingRequestRef = useRef<{ problemId: string; requestId: string } | null>(null);
  const workspaceRequestsRef = useRef(new Set<string>());
  const currentProblemIdRef = useRef(initialData.problem?.id ?? null);

  const agentPageContext = stage !== "loading" && data?.problem
    ? {
        problemId: data.problem.id,
        problemTitle: data.problem.title,
        page: "review" as const,
        activePanel: workspaceTab,
      }
    : null;
  useAgentPageContext(agentPageContext);
  const { open: coachOpen, setOpen: setCoachOpen } = useAgentShellControls();
  useEmbeddedAgentPanel(stage === "review" && Boolean(data?.problem));

  const loadNext = useCallback(async (targetId?: string | null) => {
    setStage("loading");
    currentProblemIdRef.current = null;
    setUserFsrsRating(null);
    setQuizSuggestedRating(null);
    setCards(null);
    setSubmissions(null);
    setNotes(null);
    setWorkspaceLoading({});
    setWorkspaceErrors({});
    workspaceRequestsRef.current.clear();
    setCardIdx(0);
    setFlipped(false);
    setResult(null);
    setError(null);
    const url = targetId
      ? `/api/review/next?problemId=${encodeURIComponent(targetId)}`
      : "/api/review/next";
    const res = await fetch(url, { cache: "no-store" });
    if (res.redirected && new URL(res.url).pathname === "/login") {
      window.location.assign("/login?next=/review");
      return;
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok || !contentType.includes("application/json")) {
      setError(t.review.sessionExpired);
      window.location.assign("/login?next=/review");
      return;
    }
    const json = (await res.json()) as ReviewPayloadDto;
    currentProblemIdRef.current = json.problem?.id ?? null;
    setData(json);
    setStage(json.problem ? "review" : "empty");
  }, [t.review.sessionExpired]);

  useEffect(() => {
    // The server already loaded a targeted review. Consume the deep-link once
    // so refresh/Next returns to the normal due queue.
    if (initialTargetId) window.history.replaceState(null, "", "/review");
  }, [initialTargetId]);

  const loadWorkspaceResource = useCallback(async (
    resource: WorkspaceResource,
    force = false,
  ) => {
    const problemId = currentProblemIdRef.current;
    if (!problemId) return;

    const alreadyLoaded =
      resource === "cards"
        ? cards !== null
        : resource === "submissions"
          ? submissions !== null
          : notes !== null;
    if (!force && alreadyLoaded) return;

    const requestKey = `${problemId}:${resource}`;
    if (workspaceRequestsRef.current.has(requestKey)) return;
    workspaceRequestsRef.current.add(requestKey);
    setWorkspaceLoading((current) => ({ ...current, [resource]: true }));
    setWorkspaceErrors((current) => {
      const next = { ...current };
      delete next[resource];
      return next;
    });

    try {
      const res = await fetch(
        `/api/problems/${encodeURIComponent(problemId)}/review-resource?resource=${resource}`,
        { cache: "no-store" },
      );
      const json = (await res.json().catch(() => null)) as {
        cards?: CardDto[];
        submissions?: SubmissionDto[];
        notes?: string;
        error?: string;
      } | null;
      if (!res.ok || !json) {
        throw new Error(json?.error ?? t.review.workspaceLoadFailed);
      }
      if (currentProblemIdRef.current !== problemId) return;

      if (resource === "cards") {
        setCards(json.cards ?? []);
        setCardIdx(0);
        setFlipped(false);
      } else if (resource === "submissions") {
        setSubmissions(json.submissions ?? []);
      } else {
        setNotes(json.notes ?? "");
      }
    } catch (loadError) {
      if (currentProblemIdRef.current !== problemId) return;
      setWorkspaceErrors((current) => ({
        ...current,
        [resource]:
          loadError instanceof Error
            ? loadError.message
            : t.review.workspaceLoadFailed,
      }));
    } finally {
      workspaceRequestsRef.current.delete(requestKey);
      if (currentProblemIdRef.current === problemId) {
        setWorkspaceLoading((current) => ({
          ...current,
          [resource]: false,
        }));
      }
    }
  }, [cards, notes, submissions, t.review.workspaceLoadFailed]);

  const selectWorkspaceTab = useCallback((tab: WorkspaceTab) => {
    setWorkspaceTab(tab);
    try {
      localStorage.setItem(LAST_WORKSPACE_TAB_KEY, tab);
    } catch {}
    if (tab !== "quiz") void loadWorkspaceResource(tab);
  }, [loadWorkspaceResource]);

  useEffect(() => {
    let preferred = DEFAULT_WORKSPACE_TAB;
    try {
      const stored = localStorage.getItem(LAST_WORKSPACE_TAB_KEY);
      if (stored === "quiz" || stored === "cards" || stored === "submissions" || stored === "notes") {
        preferred = stored;
      }
    } catch {}
    selectWorkspaceTab(preferred);
  }, [selectWorkspaceTab, data?.problem?.id]);

  const submitRating = useCallback(async () => {
    if (!data?.problem || !userFsrsRating) return;
    if (ratingRequestRef.current?.problemId !== data.problem.id) {
      ratingRequestRef.current = { problemId: data.problem.id, requestId: crypto.randomUUID() };
    }
    const requestId = ratingRequestRef.current.requestId;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/review/rate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          problemId: data.problem.id,
          rating: userFsrsRating,
          requestId,
          ...(notes !== null ? { notes } : {}),
        }),
      });
      if (res.status === 409) {
        setError(t.review.ratedElsewhere);
        setSubmitting(false);
        await loadNext();
        return;
      }
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error ?? "rate_failed");
        setSubmitting(false);
        return;
      }
      const nextResult = (await res.json()) as RateResult;
      setResult(nextResult);
      notifyReviewQueueUpdated(nextResult.queue?.dueCount);
      ratingRequestRef.current = null;
      setStage("result");
    } catch {
      setError(t.review.networkTryAgain);
    }
    setSubmitting(false);
  }, [data, userFsrsRating, notes, loadNext, t.review.networkTryAgain, t.review.ratedElsewhere]);

  const undoRating = useCallback(async () => {
    if (!data?.problem || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/review/undo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ problemId: data.problem.id }),
      });
      if (!res.ok) {
        setError(t.review.undoFailed);
        setSubmitting(false);
        return;
      }
      const undoResult = (await res.json()) as {
        queue?: { dueCount?: number };
      };
      notifyReviewQueueUpdated(undoResult.queue?.dueCount);
      setSubmitting(false);
      // Re-enter the same problem with its restored pre-rating state.
      await loadNext(data.problem.id);
    } catch {
      setError(t.review.networkTryAgain);
      setSubmitting(false);
    }
  }, [data, submitting, loadNext, t.review.undoFailed, t.review.networkTryAgain]);

  // Page-level shortcuts: 1-4 select rating, Enter submits (or advances the
  // result screen), A-D answer the quiz, Space flips cards / continues quiz
  // feedback, arrows navigate cards. All ignored while typing.
  const cardCount = cards?.length ?? 0;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      ) {
        return;
      }

      // "?" is the conventional help key and works from any stage or tab.
      if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen((open) => !open);
        return;
      }
      // Let Enter/Space activate a focused control instead of hijacking it.
      const interactiveFocused = target?.closest?.("button, a, select, [role='separator']") != null;
      const isEnter = e.key === "Enter";
      const isSpace = e.key === " ";
      if ((isEnter || isSpace) && interactiveFocused) return;

      if (stage === "result") {
        if (isEnter || isSpace) {
          e.preventDefault();
          void loadNext();
        }
        return;
      }
      if (stage !== "review") return;

      if (workspaceTab === "quiz") {
        const quiz = quizKeysRef.current;
        const choice = "abcd".indexOf(e.key.toLowerCase());
        if (quiz && choice >= 0 && e.key.length === 1) {
          e.preventDefault();
          quiz.answer(choice);
          return;
        }
        if ((isEnter || isSpace) && quiz?.advance()) {
          e.preventDefault();
          return;
        }
        // Inside the quiz, Enter never falls through to rating submit.
        if (isEnter || isSpace) return;
      }

      if (workspaceTab === "cards") {
        if (isSpace) {
          e.preventDefault();
          setFlipped((f) => !f);
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setCardIdx((i) => Math.max(0, i - 1));
          setFlipped(false);
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          setCardIdx((i) => Math.min(Math.max(0, cardCount - 1), i + 1));
          setFlipped(false);
          return;
        }
      }

      if (e.key >= "1" && e.key <= "4") {
        e.preventDefault();
        setUserFsrsRating(Number(e.key) as FsrsRating);
        return;
      }
      if (isEnter && userFsrsRating !== null) {
        e.preventDefault();
        void submitRating();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [stage, workspaceTab, cardCount, loadNext, submitRating, userFsrsRating]);

  const handleQuizCardSaved = useCallback((card: CardDto) => {
    setCards((current) => {
      if (!current) return current;
      if (current.some((existing) => existing.id === card.id)) return current;
      return [card, ...current];
    });
  }, []);

  if (stage === "loading" || !data) return <p className="text-muted p-8 text-center">{t.common.loading}</p>;

  if (stage === "empty" || !data.problem) {
    return (
      <Surface className="p-10 text-center">
        <h1 className="text-2xl font-semibold">{t.review.nothingDue}</h1>
        <p className="mt-2 text-sm text-muted">{t.review.nothingDueDescription}</p>
        <Link href="/problems" className={buttonClasses({ className: "mt-4" })}>
          {t.review.browseProblems}
        </Link>
      </Surface>
    );
  }

  const problem = data.problem;
  const currentCard = cards?.[cardIdx] ?? null;

  return (
    <div className="space-y-4">
      <ShortcutsHelp open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {stage === "review" && (
        <ReviewWorkspaceLayout
          question={(
            <StatementPanel
              problem={problem}
              previews={data.previews}
              previewedAt={data.previewedAt}
              userFsrsRating={userFsrsRating}
              quizSuggestedRating={quizSuggestedRating}
              setUserFsrsRating={setUserFsrsRating}
              error={error}
              submitting={submitting}
              onSubmitRating={submitRating}
              onOpenShortcuts={() => setShortcutsOpen(true)}
              cardTotal={cards?.length ?? null}
              dueCount={data.queue?.dueCount ?? 0}
              language={language}
            />
          )}
          study={(
            <WorkspacePanel
              activeTab={workspaceTab}
              onTabChange={selectWorkspaceTab}
              cards={cards}
              currentCard={currentCard}
              cardIdx={cardIdx}
              setCardIdx={setCardIdx}
              flipped={flipped}
              setFlipped={setFlipped}
              submissions={submissions}
              notes={notes}
              setNotes={setNotes}
              loading={workspaceLoading}
              errors={workspaceErrors}
              onRetry={(resource) => void loadWorkspaceResource(resource, true)}
              problemId={problem.id}
              onQuizCardSaved={handleQuizCardSaved}
              quizKeysRef={quizKeysRef}
              onQuizCompleted={(score) => setQuizSuggestedRating(suggestedRatingForScore(score))}
            />
          )}
          coach={(
            <AgentSidebar
              embedded
              open={coachOpen}
              onClose={() => setCoachOpen(false)}
              pageContext={{
                problemId: problem.id,
                problemTitle: problem.title,
                page: "review",
                activePanel: workspaceTab,
              }}
            />
          )}
          coachOpen={coachOpen}
          onCoachOpenChange={setCoachOpen}
          labels={{
            layouts: t.review.layouts,
            question: t.review.questionStatement,
            study: t.review.studyPanel,
            coach: t.agent.title,
            show: t.review.showPanel,
            hide: t.review.hidePanel,
            reset: t.review.resetLayout,
          }}
        />
      )}

      {stage === "result" && result && (
        <div className="space-y-4">
          <ReviewHeader
            problem={problem}
            cardTotal={cards?.length ?? null}
            dueCount={result.queue?.dueCount ?? 0}
            language={language}
          />
          <Surface className="p-8 text-center">
            <h2 className="text-xl font-semibold">{t.review.done}</h2>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <Summary label={t.review.rating} value={getRatingButtons(t).find((b) => b.rating === userFsrsRating)?.label ?? userFsrsRating} />
              <Summary label={t.review.nextReview} value={formatInterval(result.nextDue)} />
              <Summary label={t.review.remainingToday} value={result.queue?.dueCount ?? 0} />
            </div>
            <div className="mt-6 flex items-center justify-center gap-2">
              <Button size="lg" disabled={submitting} onClick={() => void undoRating()}>
                {t.review.undo}
              </Button>
              <Button variant="primary" size="lg" onClick={() => loadNext()}>
                {t.common.next}
              </Button>
            </div>
            {error && <p className="mt-3 text-xs text-danger">{error}</p>}
          </Surface>
        </div>
      )}

    </div>
  );
}

function ReviewHeader({
  problem, cardTotal, dueCount, language,
}: {
  problem: ReviewProblemDto;
  cardTotal: number | null;
  dueCount: number;
  language: "en" | "zh";
}) {
  const { t } = useLanguage();
  const tagsHidden = useSyncExternalStore(
    subscribeReviewTags,
    getReviewTagsSnapshot,
    () => false,
  );

  function toggleTags() {
    try {
      localStorage.setItem("review-tags-hidden", tagsHidden ? "0" : "1");
      window.dispatchEvent(new Event(REVIEW_TAGS_EVENT));
    } catch {}
  }

  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h1 className="max-w-[32rem] truncate text-lg font-semibold tracking-tight">
        {problem.leetcodeId != null && (
          <span className="text-muted tabular-nums">{problem.leetcodeId}. </span>
        )}
        {problem.title}
      </h1>
      <DifficultyPill difficulty={problem.difficulty} language={language} />
      <FsrsStatePill state={problem.fsrsState} language={language} />
      {!tagsHidden && problem.topicTags.slice(0, 3).map((tag) => (
        <span key={tag} className="text-xs text-muted">#{tag}</span>
      ))}
      {cardTotal !== null && (
        <span className="text-xs text-muted">· {t.common.cards(cardTotal)}</span>
      )}
      <button
        type="button"
        onClick={toggleTags}
        className="ml-auto text-[11px] text-muted hover:text-fg transition-colors"
        title={tagsHidden ? t.review.showTopicTags : t.review.hideTopicTags}
      >
        {tagsHidden ? t.review.showTags : t.review.hideTags}
      </button>
      <span className="text-xs uppercase tracking-wider text-muted">{language === "zh" ? `${dueCount} 到期` : `${dueCount} due`}</span>
    </header>
  );
}

function StatementPanel({
  problem,
  previews,
  previewedAt,
  userFsrsRating,
  quizSuggestedRating,
  setUserFsrsRating,
  error,
  submitting,
  onSubmitRating,
  onOpenShortcuts,
  cardTotal,
  dueCount,
  language,
}: {
  problem: ReviewProblemDto;
  previews: ReviewPayloadDto["previews"];
  previewedAt: string;
  userFsrsRating: FsrsRating | null;
  quizSuggestedRating: FsrsRating | null;
  setUserFsrsRating: (rating: FsrsRating) => void;
  error: string | null;
  submitting: boolean;
  onSubmitRating: () => void;
  onOpenShortcuts: () => void;
  cardTotal: number | null;
  dueCount: number;
  language: "en" | "zh";
}) {
  const { t } = useLanguage();
  return (
    <Surface className="flex h-full min-h-[420px] flex-col overflow-hidden lg:min-h-0">
      <div className="shrink-0 border-b border-border px-4 py-3">
        <ReviewHeader
          problem={problem}
          cardTotal={cardTotal}
          dueCount={dueCount}
          language={language}
        />
      </div>
      <div className="shrink-0 border-b border-border px-4 py-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
          {t.review.questionStatement}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        {problem.descriptionMd ? (
          <Markdown className="[&_code]:break-words">{stripConstraints(problem.descriptionMd)}</Markdown>
        ) : (
          <p className="text-sm text-muted">{t.review.noDescription}</p>
        )}
      </div>

      {/* Rating is problem-level — lives alongside the problem statement */}
      <CompactRating
        previews={previews}
        previewedAt={previewedAt}
        userFsrsRating={userFsrsRating}
        quizSuggestedRating={quizSuggestedRating}
        setUserFsrsRating={setUserFsrsRating}
        error={error}
        submitting={submitting}
        onSubmitRating={onSubmitRating}
        onOpenShortcuts={onOpenShortcuts}
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
  notes,
  setNotes,
  loading,
  errors,
  onRetry,
  problemId,
  onQuizCardSaved,
  quizKeysRef,
  onQuizCompleted,
}: {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  cards: CardDto[] | null;
  currentCard: CardDto | null;
  cardIdx: number;
  setCardIdx: Dispatch<SetStateAction<number>>;
  flipped: boolean;
  setFlipped: Dispatch<SetStateAction<boolean>>;
  submissions: SubmissionDto[] | null;
  notes: string | null;
  setNotes: (value: string) => void;
  loading: Partial<Record<WorkspaceResource, boolean>>;
  errors: Partial<Record<WorkspaceResource, string>>;
  onRetry: (resource: WorkspaceResource) => void;
  problemId: string;
  onQuizCardSaved: (card: CardDto) => void;
  quizKeysRef: MutableRefObject<QuizKeyInterface | null>;
  onQuizCompleted: (score: number) => void;
}) {
  const { t } = useLanguage();
  const tabs: { id: WorkspaceTab; label: string; count?: number }[] = [
    { id: "quiz", label: t.review.quiz },
    { id: "cards", label: t.review.cards, count: cards?.length },
    { id: "submissions", label: t.review.submissions, count: submissions?.length },
    { id: "notes", label: t.review.notes },
  ];

  return (
    <Surface className="flex h-full min-h-[620px] flex-col overflow-hidden lg:min-h-0">
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div
          role="tablist"
          aria-label={t.review.workspace}
          className="flex rounded-lg bg-subtle p-1"
          onKeyDown={(event) => moveTabFocus(event)}
        >
          {tabs.map((tab) => (
            <ReviewTabButton
              key={tab.id}
              id={tab.id}
              label={tab.label}
              count={tab.count}
              active={activeTab === tab.id}
              onClick={() => onTabChange(tab.id)}
            />
          ))}
        </div>
      </div>

      <div
        id={`review-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`review-tab-${activeTab}`}
        className="min-h-0 flex-1 overflow-hidden"
      >
        {activeTab === "quiz" && (
          <LazyQuizPanel
            problemId={problemId}
            onCardSaved={onQuizCardSaved}
            quizKeysRef={quizKeysRef}
            onCompleted={onQuizCompleted}
          />
        )}

        {activeTab === "cards" && (
          <WorkspaceResourceState
            loading={loading.cards === true}
            error={errors.cards}
            onRetry={() => onRetry("cards")}
          >
            <LazyCardReviewPanel
              cards={cards ?? []}
              currentCard={currentCard}
              cardIdx={cardIdx}
              setCardIdx={setCardIdx}
              flipped={flipped}
              setFlipped={setFlipped}
              problemId={problemId}
            />
          </WorkspaceResourceState>
        )}

        {activeTab === "submissions" && (
          <WorkspaceResourceState
            loading={loading.submissions === true}
            error={errors.submissions}
            onRetry={() => onRetry("submissions")}
          >
            <div className="h-full overflow-y-auto p-4">
              {(submissions?.length ?? 0) === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <EmptyState title={t.review.noSubmissions} />
                </div>
              ) : (
                <LazySubmissionList submissions={submissions ?? []} />
              )}
            </div>
          </WorkspaceResourceState>
        )}

        {activeTab === "notes" && (
          <WorkspaceResourceState
            loading={loading.notes === true}
            error={errors.notes}
            onRetry={() => onRetry("notes")}
          >
            <LazyNotesEditor
              notes={notes ?? ""}
              setNotes={setNotes}
              problemId={problemId}
            />
          </WorkspaceResourceState>
        )}
      </div>
    </Surface>
  );
}

function WorkspaceResourceState({
  loading,
  error,
  onRetry,
  children,
}: {
  loading: boolean;
  error?: string;
  onRetry: () => void;
  children: React.ReactNode;
}) {
  const { t } = useLanguage();
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div>
          <p className="text-sm text-danger">{error}</p>
          <Button className="mt-3" size="sm" onClick={onRetry}>
            {t.common.retry}
          </Button>
        </div>
      </div>
    );
  }
  return children;
}

function ReviewTabButton({
  id,
  label,
  count,
  active,
  onClick,
}: {
  id: WorkspaceTab;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      id={`review-tab-${id}`}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={`review-panel-${id}`}
      tabIndex={active ? 0 : -1}
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

function CompactRating({
  previews,
  previewedAt,
  userFsrsRating,
  quizSuggestedRating,
  setUserFsrsRating,
  error,
  submitting,
  onSubmitRating,
  onOpenShortcuts,
}: {
  previews: ReviewPayloadDto["previews"];
  previewedAt: string;
  userFsrsRating: FsrsRating | null;
  quizSuggestedRating: FsrsRating | null;
  setUserFsrsRating: (rating: FsrsRating) => void;
  error: string | null;
  submitting: boolean;
  onSubmitRating: () => void;
  onOpenShortcuts: () => void;
}) {
  const { t } = useLanguage();
  const ratingButtons = getRatingButtons(t);
  return (
    <div className="shrink-0 border-t border-border bg-surface/70 p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted">{t.review.rating}</span>
        {quizSuggestedRating !== null && (
          <span className="text-[10px] font-medium text-accent" role="status">
            {t.review.quizSuggestion(
              ratingButtons.find((button) => button.rating === quizSuggestedRating)?.label ?? "",
            )}
          </span>
        )}
        <button
          type="button"
          onClick={onOpenShortcuts}
          aria-label={t.review.shortcutsOpen}
          className="text-[10px] text-muted transition-colors hover:text-fg"
        >
          <span className="hidden lg:inline">{t.review.shortcutsHint}</span>
          <span className="lg:hidden">{t.review.shortcutsTitle} ?</span>
        </button>
      </div>
      <div className="flex items-stretch gap-1.5">
        {ratingButtons.map((button) => {
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
              <div className="text-xs font-semibold leading-tight">
                <span className="mr-1 text-[9px] font-normal text-muted tabular-nums">{button.rating}</span>
                {button.label}
              </div>
              <div className="mt-0.5 text-[10px] leading-tight text-muted tabular-nums">{due ? formatInterval(due, previewedAt) : "-"}</div>
            </button>
          );
        })}

        <Button
          variant="primary"
          size="sm"
          disabled={submitting || userFsrsRating === null}
          onClick={onSubmitRating}
          className="h-auto px-4"
        >
          {submitting ? <Spinner /> : t.review.submit}
        </Button>
      </div>

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}

function moveTabFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const current = tabs.indexOf(event.target as HTMLButtonElement);
  if (current < 0 || tabs.length === 0) return;
  event.preventDefault();
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[nextIndex]?.focus();
  tabs[nextIndex]?.click();
}

function Summary({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-subtle px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}


function stripConstraints(markdown: string | null | undefined) {
  if (!markdown) return "";
  const idx = markdown.search(/\n#+\s*Constraints|\nConstraints:/i);
  if (idx > 0) return markdown.slice(0, idx).trim();
  return markdown;
}

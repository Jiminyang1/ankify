"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { CardDto, QuizAnswer, QuizItem, QuizSessionDto } from "@ankify/contracts";
import {
  formatQuizMarkdown,
  type FsrsRating,
} from "@ankify/core";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { IndeterminateProgress } from "@/components/ui/indeterminate-progress";
import { Markdown } from "@/components/ui/markdown";
import { Pill } from "@/components/ui/pill";
import { Surface } from "@/components/ui/surface";
import { useLanguage } from "@/components/LanguageProvider";
import { cn } from "@/lib/utils";
import {
  getActiveAiJob,
  requireSucceededAiJob,
  startAiJob,
  waitForAiJob,
} from "@/lib/ai-job-client";

export type QuizKeyInterface = {
  answer: (choiceIndex: number) => void;
  advance: () => boolean;
};

type ReviewLabels = ReturnType<typeof useLanguage>["t"];

export function QuizPanel({
  problemId,
  onCardSaved,
  autoStart = false,
  quizKeysRef,
  onCompleted,
}: {
  problemId: string;
  onCardSaved: (card: CardDto) => void;
  /** Start generation as soon as the panel loads without a resumable session,
   *  so the wait overlaps with reading the problem statement. */
  autoStart?: boolean;
  quizKeysRef?: MutableRefObject<QuizKeyInterface | null>;
  /** Fires once when the fifth answer completes a session, with its score. */
  onCompleted?: (score: number) => void;
}) {
  const { t } = useLanguage();
  const [session, setSession] = useState<QuizSessionDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingJob, setCheckingJob] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [submittingItem, setSubmittingItem] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [feedback, setFeedback] = useState<{ item: QuizItem; answer: QuizAnswer } | null>(null);
  const [savedItemIds, setSavedItemIds] = useState<Set<string>>(new Set());
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [savingMissed, setSavingMissed] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const generationElapsedSeconds = useElapsedSeconds(generating, generationStartedAt);

  const loadSession = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFeedback(null);
    setSavedItemIds(new Set());
    setSavingMissed(false);
    setShowResults(false);
    try {
      const res = await fetch(`/api/problems/${problemId}/quiz`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as { session?: QuizSessionDto | null; error?: string } | null;
      if (!res.ok) throw new Error(json?.error ?? t.quiz.failedLoad);
      const nextSession = json?.session ?? null;
      const pendingFeedback = getStoredQuizFeedback(problemId, nextSession);
      setSession(nextSession);
      setFeedback(pendingFeedback);
      setCurrentIndex(pendingFeedback ? getQuizItemIndex(nextSession, pendingFeedback.item.id) : getFirstUnansweredIndex(nextSession));
    } catch (e) {
      setError(e instanceof Error ? e.message : t.quiz.failedLoad);
    } finally {
      setLoading(false);
    }
  }, [problemId, t.quiz.failedLoad]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSession();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadSession]);

  useEffect(() => {
    void getActiveAiJob(problemId, "quiz")
      .then(async (job) => {
        if (!job) return;
        setGenerating(true);
        setGenerationStartedAt(Date.parse(job.startedAt ?? job.queuedAt));
        setCheckingJob(false);
        requireSucceededAiJob(await waitForAiJob(job));
        await loadSession();
      })
      .catch((e) => setError(e instanceof Error ? e.message : t.quiz.failedGenerate))
      .finally(() => {
        setGenerating(false);
        setGenerationStartedAt(null);
        setCheckingJob(false);
      });
  }, [loadSession, problemId, t.quiz.failedGenerate]);

  // Auto-start generation once per problem: a missing session gets a first
  // batch, a completed one (from a previous review) gets the next batch. An
  // active session is resumed instead, and generation failures stay manual so
  // a misconfigured AI provider can't retry-loop.
  const autoStartedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!autoStart || loading || checkingJob) return;
    if (autoStartedForRef.current === problemId) return;
    autoStartedForRef.current = problemId;
    if (generating) return;
    if (!session) {
      void generateQuiz("generate");
    } else if (session.status === "completed") {
      void generateQuiz("nextBatch");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, loading, checkingJob, generating, session, problemId]);

  // Keep the page-level keyboard bridge in sync with the latest quiz state.
  useEffect(() => {
    if (!quizKeysRef) return;
    quizKeysRef.current = {
      answer: (choiceIndex: number) => {
        if (!session || session.status !== "active" || loading || generating || submittingItem) return;
        const item = session.itemsJson[currentIndex];
        if (!item || choiceIndex >= item.choices.length) return;
        if (feedback || isQuizItemAnswered(session, item.id)) return;
        void submitAnswer(item, choiceIndex);
      },
      advance: () => {
        if (!session || loading || generating) return false;
        if (session.status === "completed" && !feedback) return false;
        const item = session.itemsJson[currentIndex];
        if (!item) return false;
        const showingFeedback = feedback?.item.id === item.id || isQuizItemAnswered(session, item.id);
        if (!showingFeedback) return false;
        goNext();
        return true;
      },
    };
    return () => {
      quizKeysRef.current = null;
    };
  });

  async function generateQuiz(action: "generate" | "regenerate" | "nextBatch") {
    setGenerating(true);
    setGenerationStartedAt(Date.now());
    setError(null);
    setFeedback(null);
    setShowResults(false);
    try {
      const job = await startAiJob({
        action: action === "generate"
          ? "quiz_generate"
          : action === "regenerate"
            ? "quiz_regenerate"
            : "quiz_next_batch",
        problemId,
        requestId: crypto.randomUUID(),
        expectedQuizSessionId: session?.id ?? null,
      });
      requireSucceededAiJob(await waitForAiJob(job));
      if (session) clearStoredQuizFeedback(problemId, session.id);
      await loadSession();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.quiz.failedGenerate);
    } finally {
      setGenerating(false);
      setGenerationStartedAt(null);
    }
  }

  async function resetHistory() {
    setResetting(true);
    setResetError(null);
    setError(null);
    try {
      const res = await fetch(`/api/problems/${problemId}/quiz`, { method: "DELETE" });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      if (session) clearStoredQuizFeedback(problemId, session.id);
      setSession(null);
      setSavedItemIds(new Set());
      setFeedback(null);
      setCurrentIndex(0);
      setShowResults(false);
      setResetDialogOpen(false);
    } catch (e) {
      setResetError(e instanceof Error ? e.message : t.quiz.failedReset);
    } finally {
      setResetting(false);
    }
  }

  const resetDialog = (
    <ConfirmDialog
      open={resetDialogOpen}
      title={t.quiz.resetHistory}
      description={t.quiz.resetConfirm}
      cancelLabel={t.common.cancel}
      confirmLabel={resetting ? t.common.loading : t.quiz.resetHistory}
      busy={resetting}
      error={resetError}
      onClose={() => {
        if (!resetting) {
          setResetDialogOpen(false);
          setResetError(null);
        }
      }}
      onConfirm={() => void resetHistory()}
    />
  );

  async function submitAnswer(item: QuizItem, selectedIndex: number) {
    if (!session || isQuizItemAnswered(session, item.id) || submittingItem) return;
    setSubmittingItem(true);
    setError(null);
    try {
      const res = await fetch(`/api/problems/${problemId}/quiz/${session.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId: item.id, selectedIndex }),
      });
      if (res.status === 409) {
        setError(t.quiz.changedElsewhere);
        await loadSession();
        return;
      }
      const json = (await res.json().catch(() => null)) as {
        session?: QuizSessionDto;
        item?: QuizItem;
        answer?: QuizAnswer;
        error?: string;
      } | null;
      if (!res.ok || !json?.session || !json.item || !json.answer) {
        throw new Error(json?.error ?? t.quiz.failedSubmit);
      }
      setSession(json.session);
      storeQuizFeedback(problemId, json.session.id, json.item.id);
      setFeedback({ item: json.item, answer: json.answer });
      if (json.session.status === "completed" && session.status !== "completed") {
        onCompleted?.(json.session.score ?? 0);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t.quiz.failedSubmit);
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
      const json = (await res.json().catch(() => null)) as { card?: CardDto; error?: string } | null;
      if (!res.ok) throw new Error(json?.error ?? t.quiz.failedSave);
      if (json?.card) onCardSaved(json.card);
      setSavedItemIds((prev) => new Set(prev).add(item.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t.quiz.failedSave);
    } finally {
      setSavingItemId(null);
    }
  }

  async function saveMissedAsCards() {
    if (!session || savingMissed) return;
    const missedItems = getMissedQuizItems(session).filter((item) => !savedItemIds.has(item.id));
    if (missedItems.length === 0) return;
    setSavingMissed(true);
    try {
      for (const item of missedItems) {
        await saveAsCard(item);
      }
    } finally {
      setSavingMissed(false);
    }
  }

  function goNext() {
    if (!session) return;
    if (feedback) clearStoredQuizFeedback(problemId, session.id);
    setFeedback(null);
    setCurrentIndex(getNextUnansweredIndex(session, currentIndex));
  }

  function goToQuestion(index: number) {
    if (!session) return;
    if (feedback) clearStoredQuizFeedback(problemId, session.id);
    setFeedback(null);
    setCurrentIndex(clamp(index, 0, session.itemsJson.length - 1));
  }

  if (loading || checkingJob) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState title={t.quiz.loading} />
      </div>
    );
  }

  if (generating && !session) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Surface className="w-full max-w-md p-5 text-center">
          <IndeterminateProgress
            label={t.quiz.pendingTitle}
            className="mx-auto w-32"
          />
          <h3 className="mt-4 text-sm font-semibold">{t.quiz.pendingTitle}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {t.quiz.pendingBody}
          </p>
          <QuizGenerationTimer elapsedSeconds={generationElapsedSeconds} className="mt-3 justify-center" />
        </Surface>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Surface className="w-full max-w-md p-5 text-center">
          <Pill tone="accent">Quiz</Pill>
          <EmptyState
            className="px-0 pb-0 pt-3"
            title={t.quiz.noQuizTitle}
            description={t.quiz.noQuizBody}
            action={
              <Button
                variant="primary"
                size="sm"
                disabled={generating}
                onClick={() => void generateQuiz("generate")}
              >
                {generating ? t.quiz.generating : t.quiz.generateFive}
              </Button>
            }
          />
          {error && <p className="mt-3 text-xs text-danger">{error}</p>}
        </Surface>
      </div>
    );
  }

  if (session.status === "completed" && !feedback) {
    const suggested = getSuggestedRating(session.score ?? 0, t);
    const missedItems = getMissedQuizItems(session);
    const unsavedMissedCount = missedItems.filter((item) => !savedItemIds.has(item.id)).length;
    const accuracy = Math.round(((session.score ?? 0) / Math.max(1, session.itemsJson.length)) * 100);
    const scopeBreakdown = getQuizBreakdown(session, "scope", t);
    const sourceBreakdown = getQuizBreakdown(session, "source", t);
    const missedScopes = Array.from(new Set(missedItems.map((item) => item.scope))).map((scope) => formatQuizScope(scope, t));
    return (
      <div className="flex h-full flex-col overflow-hidden">
        {resetDialog}
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <Surface className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-lg border border-accent/30 bg-bg px-3 py-2">
                <div className="text-2xl font-bold leading-none tabular-nums">
                  {session.score ?? 0}<span className="text-sm font-semibold text-muted">/{session.itemsJson.length}</span>
                </div>
                <div className="mt-1 text-[11px] font-semibold text-muted tabular-nums">{accuracy}% · {suggested.label}</div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{t.quiz.batchComplete}</div>
                <div className="mt-1 text-xs text-muted">
                  {missedItems.length === 0 ? t.quiz.noMisses : t.quiz.missed(missedItems.length)} · {t.quiz.coverageBalanced}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={generating}
                  onClick={() => {
                    setResetError(null);
                    setResetDialogOpen(true);
                  }}
                  title={t.quiz.resetHistoryTitle}
                  className="text-muted hover:bg-danger/10 hover:text-danger"
                >
                  {t.quiz.resetHistory}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={generating}
                  onClick={() => void generateQuiz("nextBatch")}
                >
                  {generating ? t.quiz.generating : t.quiz.newBatch}
                </Button>
              </div>
            </div>
            {generating && <QuizGenerationTimer elapsedSeconds={generationElapsedSeconds} className="mt-3" />}
            {error && <p className="mt-3 text-xs text-danger">{error}</p>}

            <div className="mt-4 space-y-2 border-t border-border pt-3">
              <QuizBreakdown label={t.quiz.scope} items={scopeBreakdown} />
              <QuizBreakdown label={t.quiz.source} items={sourceBreakdown} />
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wide">{t.quiz.missedLabel}</span>
                <span>{missedScopes.length > 0 ? missedScopes.join(" · ") : t.quiz.none}</span>
              </div>
              <Button
                size="sm"
                disabled={unsavedMissedCount === 0 || savingMissed}
                onClick={() => void saveMissedAsCards()}
                className="border-accent/30 bg-accent-soft text-accent hover:border-accent/50 hover:bg-accent-soft disabled:border-border disabled:bg-subtle disabled:text-muted"
              >
                {savingMissed ? t.quiz.creating : unsavedMissedCount === 0 ? t.quiz.cardsSaved : t.quiz.createCards}
                {unsavedMissedCount > 0 && !savingMissed && (
                  <span className="rounded-full bg-accent/15 px-1.5 text-[10px] tabular-nums">{unsavedMissedCount}</span>
                )}
              </Button>
            </div>
          </Surface>

          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowResults((value) => !value)}
              className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-left text-xs hover:bg-subtle"
            >
              <span className="font-semibold">{showResults ? t.quiz.hideQuiz : t.quiz.reviewQuiz}</span>
              <span className="text-muted">{showResults ? t.quiz.hideAnswers : t.quiz.expandQuestions}</span>
            </button>
          </div>

          {showResults && (
            <div className="mt-4 space-y-3">
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
                    labels={t}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  const item = session.itemsJson[currentIndex] ?? session.itemsJson[0];
  if (!item) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          title={t.quiz.noQuestions}
          action={
            <Button
              variant="primary"
              size="sm"
              disabled={generating}
              onClick={() => void generateQuiz("regenerate")}
            >
              {generating ? t.quiz.regenerating : t.quiz.regenerateQuiz}
            </Button>
          }
        />
      </div>
    );
  }
  const answeredCount = session.answersJson.length;
  const activeAnswer = session.answersJson.find((answer) => answer.itemId === item.id) ?? null;
  const activeFeedback = feedback?.item.id === item.id ? feedback : activeAnswer ? { item, answer: activeAnswer } : null;
  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < session.itemsJson.length - 1;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {resetDialog}
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted">
              {t.quiz.questionProgress(currentIndex + 1, session.itemsJson.length, answeredCount)}
            </div>
            <div className="mt-1 h-1.5 w-32 overflow-hidden rounded-full bg-subtle">
              <div
                className="h-full rounded-full bg-accent/80 transition-all"
                style={{ width: `${Math.max(8, (answeredCount / session.itemsJson.length) * 100)}%` }}
              />
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              disabled={!canGoPrev}
              onClick={() => goToQuestion(currentIndex - 1)}
              className="text-muted"
            >
              {t.common.previous}
            </Button>
            <Button
              size="sm"
              disabled={!canGoNext}
              onClick={() => goToQuestion(currentIndex + 1)}
              className="text-muted"
            >
              {t.common.next}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={generating}
              onClick={() => void generateQuiz("regenerate")}
              className="text-muted"
            >
              {t.quiz.regenerateQuiz}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={generating}
              onClick={() => {
                setResetError(null);
                setResetDialogOpen(true);
              }}
              title={t.quiz.resetHistoryTitle}
              className="text-muted hover:bg-danger/10 hover:text-danger"
            >
              {t.quiz.resetHistory}
            </Button>
          </div>
        </div>
        {generating && <QuizGenerationTimer elapsedSeconds={generationElapsedSeconds} className="mt-2" />}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-5">
        <div className="mx-auto max-w-2xl">
          <div className="rounded-lg border border-border bg-subtle/40 px-4 py-4 sm:px-5">
            <Markdown className="text-base font-medium leading-relaxed [&_p]:text-base">{formatQuizMarkdown(item.question)}</Markdown>
          </div>

          <div className="mt-4 space-y-2">
            {item.choices.map((choice, index) => {
              const wasSelected = activeFeedback?.answer.selectedIndex === index;
              const isCorrect = activeFeedback && item.answerIndex === index;
              return (
                <button
                  key={index}
                  type="button"
                  disabled={!!activeFeedback || submittingItem}
                  onClick={() => void submitAnswer(item, index)}
                  className={cn(
                    "group w-full rounded-lg border px-4 py-3 text-left transition",
                    "border-border bg-surface hover:border-accent/40 hover:bg-subtle/70 disabled:cursor-default",
                    activeFeedback && isCorrect ? "border-success/50 bg-success/10" : "",
                    activeFeedback && wasSelected && !isCorrect ? "border-danger/50 bg-danger/10" : "",
                  )}
                >
                  <div className="flex gap-3">
                    <span className={cn(
                      "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] font-semibold",
                      "border-border text-muted group-hover:border-accent/40 group-hover:text-accent",
                      activeFeedback && isCorrect ? "border-success/40 text-success" : "",
                      activeFeedback && wasSelected && !isCorrect ? "border-danger/40 text-danger" : "",
                    )}>
                      {String.fromCharCode(65 + index)}
                    </span>
                    <Markdown className="min-w-0 flex-1 text-sm">{formatQuizMarkdown(choice)}</Markdown>
                  </div>
                </button>
              );
            })}
          </div>

          {activeFeedback ? (
            <div
              className={cn(
                "mt-3 overflow-hidden rounded-lg border bg-surface",
                activeFeedback.answer.correct ? "border-success/35" : "border-danger/35",
              )}
            >
              <div
                className={cn(
                  "flex items-center justify-between gap-3 border-b px-3 py-1.5",
                  activeFeedback.answer.correct
                    ? "border-success/20 bg-success/5"
                    : "border-danger/20 bg-danger/5",
                )}
              >
                <div className={cn("text-xs font-semibold", activeFeedback.answer.correct ? "text-success" : "text-danger")}>
                  {activeFeedback.answer.correct ? t.quiz.correct : t.quiz.wrong}
                </div>
                <span className="text-[11px] text-muted">
                  {formatQuizSource(item.source, t)} · {formatQuizScope(item.scope, t)}
                </span>
              </div>
              <Markdown className="px-3 py-2.5 text-sm leading-relaxed">{formatQuizMarkdown(item.explanation)}</Markdown>
              <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
                <Button
                  size="sm"
                  disabled={savedItemIds.has(item.id) || savingItemId === item.id}
                  onClick={() => void saveAsCard(item)}
                  className="text-muted"
                >
                  {savedItemIds.has(item.id) ? t.quiz.saved : savingItemId === item.id ? t.quiz.saving : t.quiz.save}
                </Button>
                <Button variant="primary" size="sm" onClick={goNext}>
                  {session.status === "completed" ? t.quiz.results : t.common.next}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <span>{submittingItem ? t.quiz.checking : t.quiz.answerHint}</span>
              {answeredCount < session.itemsJson.length && !canGoNext && (
                <Button size="sm" onClick={() => goToQuestion(getFirstUnansweredIndex(session))}>
                  {t.quiz.firstUnanswered}
                </Button>
              )}
            </div>
          )}

          {error && <p className="mt-3 text-xs text-danger">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function QuizGenerationTimer({ elapsedSeconds, className }: { elapsedSeconds: number; className?: string }) {
  const { t } = useLanguage();
  return (
    <div className={cn("flex items-center gap-2 text-xs text-muted tabular-nums", className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      <span>{t.quiz.generateTimer(formatElapsedSeconds(elapsedSeconds))}</span>
    </div>
  );
}

function useElapsedSeconds(active: boolean, startedAt: number | null) {
  const [clock, setClock] = useState<{ startedAt: number | null; now: number }>({
    startedAt: null,
    now: 0,
  });
  useEffect(() => {
    if (!active || !startedAt) return;
    const timer = window.setInterval(
      () => setClock({ startedAt, now: Date.now() }),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [active, startedAt]);
  if (!active || !startedAt || clock.startedAt !== startedAt) return 0;
  return Math.max(0, Math.floor((clock.now - startedAt) / 1000));
}

function formatElapsedSeconds(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function QuizResultItem({
  index,
  item,
  answer,
  saved,
  saving,
  onSave,
  labels,
}: {
  index: number;
  item: QuizItem;
  answer: QuizAnswer | null;
  saved: boolean;
  saving: boolean;
  onSave: () => void;
  labels: ReviewLabels;
}) {
  const correctChoice = item.choices[item.answerIndex] ?? "";
  const selectedChoice = answer ? item.choices[answer.selectedIndex] : null;
  const t = labels;
  return (
    <Surface className="p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>{t.quiz.resultQuestion(index + 1)}</span>
        {answer && (
          <Pill tone={answer.correct ? "success" : "danger"}>
            {answer.correct ? t.quiz.correct : t.quiz.incorrect}
          </Pill>
        )}
        <span className="ml-auto">{formatQuizSource(item.source, t)}</span>
        <span>{formatQuizScope(item.scope, t)}</span>
      </div>
      <Markdown className="mt-2 text-sm font-medium">{formatQuizMarkdown(item.question)}</Markdown>
      {selectedChoice && (
        <div className="mt-3 text-xs text-muted">
          {t.quiz.yourAnswer} <Markdown className="inline text-fg [&_code]:text-[0.95em] [&_p]:inline">{formatQuizMarkdown(selectedChoice)}</Markdown>
        </div>
      )}
      <div className="mt-1 text-xs text-muted">
        {t.quiz.correctAnswer} <Markdown className="inline text-fg [&_code]:text-[0.95em] [&_p]:inline">{formatQuizMarkdown(correctChoice)}</Markdown>
      </div>
      <Markdown className="mt-3 text-sm">{formatQuizMarkdown(item.explanation)}</Markdown>
      <Button size="sm" className="mt-3" disabled={saved || saving} onClick={onSave}>
        {saved ? t.quiz.saved : saving ? t.quiz.saving : t.quiz.save}
      </Button>
    </Surface>
  );
}

function QuizBreakdown({ label, items }: { label: string; items: { label: string; count: number }[] }) {
  return (
    <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-start gap-2">
      <div className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</div>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <Pill key={item.label}>
            {item.label} <span className="tabular-nums">{item.count}</span>
          </Pill>
        ))}
      </div>
    </div>
  );
}

function getMissedQuizItems(session: QuizSessionDto) {
  return session.itemsJson.filter((item) => {
    const answer = session.answersJson.find((a) => a.itemId === item.id);
    return answer && !answer.correct;
  });
}

function getQuizBreakdown(session: QuizSessionDto, field: "scope" | "source", t: ReviewLabels) {
  const counts = new Map<string, number>();
  session.itemsJson.forEach((item) => {
    const key = field === "scope" ? formatQuizScope(item.scope, t) : formatQuizSource(item.source, t);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return Array.from(counts.entries()).map(([label, count]) => ({ label, count }));
}

function formatQuizScope(scope: QuizItem["scope"], t: ReviewLabels) {
  return t.quiz.scopes[scope];
}

function formatQuizSource(source: QuizItem["source"], t: ReviewLabels) {
  return t.quiz.sources[source];
}

function getFirstUnansweredIndex(session: QuizSessionDto | null) {
  if (!session) return 0;
  const idx = session.itemsJson.findIndex((item) => !session.answersJson.some((answer) => answer.itemId === item.id));
  return idx === -1 ? 0 : idx;
}

function getNextUnansweredIndex(session: QuizSessionDto, currentIndex: number) {
  const afterCurrent = session.itemsJson.findIndex((item, index) => index > currentIndex && !isQuizItemAnswered(session, item.id));
  if (afterCurrent !== -1) return afterCurrent;
  return getFirstUnansweredIndex(session);
}

function isQuizItemAnswered(session: QuizSessionDto, itemId: string) {
  return session.answersJson.some((answer) => answer.itemId === itemId);
}

function getQuizItemIndex(session: QuizSessionDto | null, itemId: string) {
  if (!session) return 0;
  const idx = session.itemsJson.findIndex((item) => item.id === itemId);
  return idx === -1 ? getFirstUnansweredIndex(session) : idx;
}

function quizFeedbackStorageKey(problemId: string, sessionId: string) {
  return `ankify.quiz.pendingFeedback.${problemId}.${sessionId}`;
}

function storeQuizFeedback(problemId: string, sessionId: string, itemId: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(quizFeedbackStorageKey(problemId, sessionId), itemId);
}

function clearStoredQuizFeedback(problemId: string, sessionId: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(quizFeedbackStorageKey(problemId, sessionId));
}

function getStoredQuizFeedback(problemId: string, session: QuizSessionDto | null) {
  if (!session || typeof window === "undefined") return null;
  const itemId = window.sessionStorage.getItem(quizFeedbackStorageKey(problemId, session.id));
  if (!itemId) return null;
  const item = session.itemsJson.find((quizItem) => quizItem.id === itemId);
  const answer = session.answersJson.find((quizAnswer) => quizAnswer.itemId === itemId);
  if (!item || !answer) {
    clearStoredQuizFeedback(problemId, session.id);
    return null;
  }
  return { item, answer };
}

function suggestedRatingForScore(score: number): FsrsRating {
  if (score <= 1) return 1;
  if (score === 2) return 2;
  if (score <= 4) return 3;
  return 4;
}

function getSuggestedRating(score: number, t: ReviewLabels): { rating: FsrsRating; label: string } {
  const rating = suggestedRatingForScore(score);
  const labels: Record<FsrsRating, string> = { 1: t.rating.again, 2: t.rating.hard, 3: t.rating.good, 4: t.rating.easy };
  return { rating, label: labels[rating] };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

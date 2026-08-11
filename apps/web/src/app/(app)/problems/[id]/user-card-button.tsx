"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { CardDto } from "@ankify/contracts";
import { Markdown } from "@/components/ui/markdown";
import { Pill } from "@/components/ui/pill";
import { Surface } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { Tabs } from "@/components/ui/tabs";
import { useHydrated } from "@/lib/use-hydrated";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import { useLanguage } from "@/components/LanguageProvider";
import {
  getActiveAiJob,
  requireSucceededAiJob,
  startAiJob,
  waitForAiJob,
} from "@/lib/ai-job-client";

type Mode = "manual" | "ai";
type Candidate = CardDto & {
  instruction: string;
  localError: string | null;
  busy: "followup" | "confirm" | "discard" | null;
};

const CARD_GENERATION_TARGET_SECONDS = 60;
const COMPOSER_ACTION_CLASS = "min-w-24";

function hydrateCandidate(card: CardDto): Candidate {
  return { ...card, instruction: "", localError: null, busy: null };
}

function apiErrorMessage(json: { error?: string; message?: string }, fallback: string) {
  return json.message ?? json.error ?? fallback;
}

export function UserCardButton({
  problemId,
  problemTitle,
  problemDescription,
}: {
  problemId: string;
  problemTitle: string;
  problemDescription?: string | null;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const mounted = useHydrated();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("manual");
  const [rawText, setRawText] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState<"auto" | "note" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [candidateBusyStartedAt, setCandidateBusyStartedAt] = useState<Record<string, number>>({});
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const generatingAi = busy === "auto" || busy === "note";
  const generationElapsedSeconds = useElapsedSeconds(generatingAi, generationStartedAt);

  const loadCandidates = useCallback(async () => {
    const res = await fetch(`/api/problems/${problemId}/ai-cards`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);

    const nextCards = json.candidates as CardDto[];
    setCandidates((prev) => {
      const prevById = new Map(prev.map((c) => [c.id, c]));
      return nextCards.map((card) => ({
        ...hydrateCandidate(card),
        instruction: prevById.get(card.id)?.instruction ?? "",
        localError: prevById.get(card.id)?.localError ?? null,
        busy: prevById.get(card.id)?.busy ?? null,
      }));
    });

    setCandidateIndex((index) => Math.min(index, Math.max(0, nextCards.length - 1)));
  }, [problemId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCandidates().catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCandidates]);

  useEffect(() => {
    void (async () => {
      try {
        const job = await getActiveAiJob(problemId, "card");
        if (!job) return;
        setBusy("auto");
        setGenerationStartedAt(Date.parse(job.startedAt ?? job.queuedAt));
        try {
          requireSucceededAiJob(await waitForAiJob(job));
          await loadCandidates();
        } finally {
          setBusy(null);
          setGenerationStartedAt(null);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : t.detail.failed);
      }
    })();
  }, [loadCandidates, problemId, t.detail.failed]);

  const resetManual = useCallback(() => {
    setRawText("");
    setQuestion("");
    setAnswer("");
    setBusy(null);
    setError(null);
  }, []);

  const closePanel = useCallback(() => {
    if (busy) return;
    setOpen(false);
    setError(null);
  }, [busy]);

  useDialogA11y({
    open,
    onClose: closePanel,
    containerRef: dialogRef,
    initialFocusRef: closeButtonRef,
  });

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  async function saveManualCard() {
    if (!question.trim() || !answer.trim()) return;
    setBusy("save");
    setError(null);
    try {
      const res = await fetch(`/api/problems/${problemId}/user-card`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "manual",
          question: question.trim(),
          answer: answer.trim(),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) throw new Error(apiErrorMessage(json, `HTTP ${res.status}`));
      resetManual();
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.common.saveFailed);
    } finally {
      setBusy(null);
    }
  }

  async function startAiGenerate(kind: "auto" | "note") {
    if (kind === "note" && !rawText.trim()) return;
    setBusy(kind);
    setGenerationStartedAt(Date.now());
    setError(null);
    setMode("ai");
    try {
      const job = await startAiJob({
        action: "card_generate",
        problemId,
        requestId: crypto.randomUUID(),
        ...(kind === "note" ? { rawText: rawText.trim() } : {}),
      });
      requireSucceededAiJob(await waitForAiJob(job));
      await loadCandidates();
      setCandidateIndex(0);
      if (kind === "note") setRawText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t.detail.failed);
    } finally {
      setBusy(null);
      setGenerationStartedAt(null);
    }
  }

  function setCandidateState(id: string, patch: Partial<Candidate>) {
    setCandidates((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  async function runCandidateAi(candidate: Candidate) {
    setCandidateState(candidate.id, { busy: "followup", localError: null });
    setCandidateBusyStartedAt((prev) => ({ ...prev, [candidate.id]: Date.now() }));
    try {
      const job = await startAiJob({
        action: "card_followup",
        problemId,
        requestId: crypto.randomUUID(),
        cardId: candidate.id,
        expectedCardVersion: candidate.version,
        draft: {
          question: candidate.question.trim(),
          answer: candidate.answer.trim(),
        },
        instruction: candidate.instruction.trim(),
      });
      requireSucceededAiJob(await waitForAiJob(job));
      setCandidateState(candidate.id, { instruction: "", busy: null });
      await loadCandidates();
    } catch (e) {
      setCandidateState(candidate.id, {
        busy: null,
        localError: e instanceof Error ? e.message : t.detail.failed,
      });
    } finally {
      setCandidateBusyStartedAt((prev) => {
        const next = { ...prev };
        delete next[candidate.id];
        return next;
      });
    }
  }

  async function confirmCandidate(candidate: Candidate) {
    if (!candidate.question.trim() || !candidate.answer.trim()) return;
    setCandidateState(candidate.id, { busy: "confirm", localError: null });
    try {
      const res = await fetch(`/api/cards/${candidate.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedVersion: candidate.version,
          aiStatus: "ready",
          question: candidate.question.trim(),
          answer: candidate.answer.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setCandidates((prev) => {
        const next = prev.filter((c) => c.id !== candidate.id);
        setCandidateIndex((index) => Math.min(index, Math.max(0, next.length - 1)));
        return next;
      });
      router.refresh();
    } catch (e) {
      setCandidateState(candidate.id, {
        busy: null,
        localError: e instanceof Error ? e.message : t.detail.failed,
      });
    }
  }

  async function discardCandidate(candidate: Candidate) {
    setCandidateState(candidate.id, { busy: "discard", localError: null });
    try {
      const res = await fetch("/api/cards", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [candidate.id] }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setCandidates((prev) => {
        const next = prev.filter((c) => c.id !== candidate.id);
        setCandidateIndex((index) => Math.min(index, Math.max(0, next.length - 1)));
        return next;
      });
    } catch (e) {
      setCandidateState(candidate.id, {
        busy: null,
        localError: e instanceof Error ? e.message : t.detail.failed,
      });
    }
  }

  const currentCandidate = candidates[candidateIndex] ?? null;
  const candidateCount = candidates.length;
  const currentCandidateStartedAt = currentCandidate ? (candidateBusyStartedAt[currentCandidate.id] ?? null) : null;
  const currentCandidateElapsedSeconds = useElapsedSeconds(currentCandidate?.busy === "followup", currentCandidateStartedAt);

  const modal =
    open &&
    mounted &&
    createPortal(
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6" role="presentation">
        <button
          type="button"
          aria-hidden
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={closePanel}
        />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="card-composer-title"
          tabIndex={-1}
          className="relative z-[101] flex max-h-[min(92vh,820px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl ring-1 ring-black/5 dark:ring-white/10"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex shrink-0 items-start justify-between gap-4 px-6 pb-4 pt-5">
            <div className="min-w-0">
              <h2 id="card-composer-title" className="text-lg font-semibold text-fg">
                {t.detail.newCard}
              </h2>
              <p className="mt-1 truncate text-sm text-muted">{problemTitle}</p>
            </div>
            <Button
              ref={closeButtonRef}
              variant="ghost"
              size="icon"
              onClick={closePanel}
              disabled={!!busy}
              aria-label={t.common.close}
              title={t.common.close}
            >
              <span aria-hidden className="text-lg leading-none">×</span>
            </Button>
          </div>

          <div className="shrink-0 border-b border-border px-6 pb-4">
            <Tabs
              tabs={[
                { id: "manual", label: t.detail.manualCard },
                {
                  id: "ai",
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      {t.detail.aiCandidates}
                      {candidateCount > 0 && (
                        <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">
                          {candidateCount}
                        </span>
                      )}
                    </span>
                  ),
                },
              ]}
              active={mode}
              onChange={(nextMode) => setMode(nextMode as Mode)}
              className="w-fit rounded-lg border border-border bg-subtle p-1"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <ProblemContext description={problemDescription} />

            {mode === "manual" ? (
              <div
                role="tabpanel"
                aria-labelledby="tab-manual"
                className="mt-5 grid gap-5"
              >
                <CardTextarea label={t.review.question} value={question} onChange={setQuestion} rows={3} disabled={!!busy} />
                <CardTextarea label={t.review.answer} value={answer} onChange={setAnswer} rows={5} disabled={!!busy} />
              </div>
            ) : (
              <div
                role="tabpanel"
                aria-labelledby="tab-ai"
                className="mt-5 space-y-4"
              >
                <Surface className="space-y-4 bg-subtle/30 p-4 shadow-none">
                  <CardTextarea
                    label={t.detail.rawNote}
                    value={rawText}
                    onChange={(value) => setRawText(value.slice(0, 6000))}
                    rows={4}
                    disabled={!!busy}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs text-muted">{rawText.length}/6000</span>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="primary"
                        className={COMPOSER_ACTION_CLASS}
                        disabled={!!busy}
                        onClick={() => startAiGenerate("auto")}
                      >
                        {busy === "auto" ? t.detail.generating : t.detail.autoGenerate}
                      </Button>
                      <Button
                        className={COMPOSER_ACTION_CLASS}
                        disabled={!!busy || !rawText.trim()}
                        onClick={() => startAiGenerate("note")}
                      >
                        {busy === "note" ? t.detail.generating : t.detail.generateFromNote}
                      </Button>
                    </div>
                  </div>
                  {generatingAi && <CardGenerationTimer elapsedSeconds={generationElapsedSeconds} />}
                </Surface>

                {error && <p className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</p>}

                {candidateCount === 0 ? (
                  <Surface className="bg-subtle/20 p-8 text-center shadow-none">
                    <p className="text-sm text-muted">{t.detail.noCandidates}</p>
                  </Surface>
                ) : currentCandidate ? (
                  <CandidateReview
                    candidate={currentCandidate}
                    index={candidateIndex}
                    count={candidateCount}
                    onPrev={() => setCandidateIndex((i) => Math.max(0, i - 1))}
                    onNext={() => setCandidateIndex((i) => Math.min(candidateCount - 1, i + 1))}
                    onChange={(patch) => setCandidateState(currentCandidate.id, patch)}
                    onFollowup={() => runCandidateAi(currentCandidate)}
                    onConfirm={() => confirmCandidate(currentCandidate)}
                    onDiscard={() => discardCandidate(currentCandidate)}
                    followupElapsedSeconds={currentCandidateElapsedSeconds}
                  />
                ) : null}
              </div>
            )}
          </div>

          {mode === "manual" && (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border bg-subtle/30 px-6 py-4">
              {error && <span className="mr-auto text-sm text-danger">{error}</span>}
              <Button
                className={COMPOSER_ACTION_CLASS}
                disabled={!!busy}
                onClick={closePanel}
              >
                {t.common.cancel}
              </Button>
              <Button
                variant="primary"
                className={COMPOSER_ACTION_CLASS}
                disabled={!!busy || !question.trim() || !answer.trim()}
                onClick={saveManualCard}
              >
                {busy === "save" ? t.common.saving : t.detail.addCard}
              </Button>
            </div>
          )}
        </div>
      </div>,
      document.body,
    );

  return (
    <div className="relative">
      <Button
        variant="primary"
        onClick={() => {
          setOpen(true);
          void loadCandidates().catch((e) => setError(e instanceof Error ? e.message : t.detail.failed));
        }}
      >
        <span aria-hidden className="text-base leading-none">+</span>
        {t.detail.addCard}
        {candidateCount > 0 ? (
          <span className="rounded bg-white/20 px-1.5 py-0.5 text-[10px]">{candidateCount}</span>
        ) : null}
      </Button>
      {modal}
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

function CardGenerationTimer({ elapsedSeconds }: { elapsedSeconds: number }) {
  const { t } = useLanguage();
  return (
    <div className="flex items-center gap-2 text-xs text-muted tabular-nums">
      <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      <span>
        {t.detail.generationProgress(
          formatElapsedSeconds(elapsedSeconds),
          formatElapsedSeconds(CARD_GENERATION_TARGET_SECONDS),
        )}
      </span>
    </div>
  );
}

function ProblemContext({ description }: { description?: string | null }) {
  const { t } = useLanguage();
  return (
    <details className="group overflow-hidden rounded-lg border border-border bg-subtle/30">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-muted transition hover:bg-subtle hover:text-fg [&::-webkit-details-marker]:hidden">
        <span>{t.review.questionStatement}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180"
        >
          <path
            d="m6 8 4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </summary>
      <div className="max-h-72 overflow-auto border-t border-border bg-surface px-4 py-4">
        {description?.trim() ? <Markdown>{description}</Markdown> : <p className="text-sm text-muted">{t.detail.noStatement}</p>}
      </div>
    </details>
  );
}

function CandidateReview({
  candidate,
  index,
  count,
  onPrev,
  onNext,
  onChange,
  onFollowup,
  onConfirm,
  onDiscard,
  followupElapsedSeconds,
}: {
  candidate: Candidate;
  index: number;
  count: number;
  onPrev: () => void;
  onNext: () => void;
  onChange: (patch: Partial<Candidate>) => void;
  onFollowup: () => void;
  onConfirm: () => void;
  onDiscard: () => void;
  followupElapsedSeconds: number;
}) {
  const { t } = useLanguage();
  const disabled = !!candidate.busy;
  return (
    <Surface className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Pill tone={candidate.aiStatus === "failed" ? "danger" : "success"}>
            {candidate.aiStatus === "failed" ? t.detail.failed : t.detail.candidate}
          </Pill>
          <span className="text-xs text-muted">
            {index + 1} / {count}
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            size="icon"
            disabled={index === 0}
            onClick={onPrev}
            aria-label={t.common.previous}
            title={t.common.previous}
          >
            <span aria-hidden>←</span>
          </Button>
          <Button
            size="icon"
            disabled={index >= count - 1}
            onClick={onNext}
            aria-label={t.common.next}
            title={t.common.next}
          >
            <span aria-hidden>→</span>
          </Button>
        </div>
      </div>

      {candidate.errorMessage && (
        <p className="rounded-md border border-danger/30 bg-danger/10 p-2 text-xs text-danger">
          {candidate.errorMessage}
        </p>
      )}

      <CardTextarea
        label={t.review.question}
        value={candidate.question}
        disabled={disabled}
        onChange={(question) => onChange({ question })}
        rows={3}
      />
      <CardTextarea
        label={t.review.answer}
        value={candidate.answer}
        disabled={disabled}
        onChange={(answer) => onChange({ answer })}
        rows={5}
      />

      <div className="rounded-lg border border-border bg-subtle/30 p-3">
        <CardTextarea
          label={t.detail.followUp}
          value={candidate.instruction}
          disabled={disabled}
          onChange={(instruction) => onChange({ instruction })}
          rows={2}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            className={COMPOSER_ACTION_CLASS}
            disabled={disabled || !candidate.question.trim() || !candidate.answer.trim() || !candidate.instruction.trim()}
            onClick={onFollowup}
          >
            {candidate.busy === "followup" ? t.detail.applying : t.detail.applyFollowUp}
          </Button>
        </div>
        {candidate.busy === "followup" && <CardGenerationTimer elapsedSeconds={followupElapsedSeconds} />}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        {candidate.localError && <span className="mr-auto text-sm text-danger">{candidate.localError}</span>}
        <Button
          className={COMPOSER_ACTION_CLASS}
          disabled={disabled && candidate.busy !== "discard"}
          onClick={onDiscard}
        >
          {candidate.busy === "discard" ? t.detail.discarding : t.common.discard}
        </Button>
        <Button
          variant="primary"
          className={COMPOSER_ACTION_CLASS}
          disabled={disabled || !candidate.question.trim() || !candidate.answer.trim()}
          onClick={onConfirm}
        >
          {candidate.busy === "confirm" ? t.detail.confirming : t.detail.confirm}
        </Button>
      </div>
    </Surface>
  );
}

function CardTextarea({
  label,
  value,
  onChange,
  rows,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
  disabled: boolean;
}) {
  return (
    <label className="block text-sm font-medium text-fg">
      <span>{label}</span>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="mt-2 bg-surface"
        disabled={disabled}
      />
    </label>
  );
}

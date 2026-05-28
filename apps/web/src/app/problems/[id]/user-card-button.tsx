"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { Card } from "@ankify/db";
import { Markdown } from "@/components/ui/markdown";
import { Pill } from "@/components/ui/pill";
import { Surface } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Mode = "manual" | "ai";
type Candidate = Card & {
  instruction: string;
  localError: string | null;
  busy: "followup" | "confirm" | "discard" | null;
};

const CARD_GENERATION_TARGET_SECONDS = 60;

function hydrateCandidate(card: Card): Candidate {
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
  const [mounted, setMounted] = useState(false);
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
  const generatingAi = busy === "auto" || busy === "note";
  const generationElapsedSeconds = useElapsedSeconds(generatingAi, generationStartedAt);

  useEffect(() => setMounted(true), []);

  const loadCandidates = useCallback(async () => {
    const res = await fetch(`/api/problems/${problemId}/ai-cards`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);

    const nextCards = json.candidates as Card[];
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
    void loadCandidates().catch(() => undefined);
  }, [loadCandidates]);

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

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closePanel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closePanel]);

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
      setError(e instanceof Error ? e.message : "Save failed");
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
      const res = await fetch(`/api/problems/${problemId}/ai-cards`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "single",
          action: "generate",
          ...(kind === "note" ? { rawText: rawText.trim() } : {}),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string; card?: Card };
      if (!res.ok) throw new Error(apiErrorMessage(json, `HTTP ${res.status}`));
      const card = json.card as Card | undefined;
      if (card) {
        setCandidates((prev) => [hydrateCandidate(card), ...prev.filter((c) => c.id !== card.id)]);
        setCandidateIndex(0);
      } else {
        await loadCandidates();
      }
      if (kind === "note") setRawText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI request failed");
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
      const res = await fetch(`/api/problems/${problemId}/ai-cards`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "single",
          action: "followup",
          cardId: candidate.id,
          draft: {
            question: candidate.question.trim(),
            answer: candidate.answer.trim(),
          },
          instruction: candidate.instruction.trim(),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string; card?: Card };
      if (!res.ok) throw new Error(apiErrorMessage(json, `HTTP ${res.status}`));
      const card = json.card as Card | undefined;
      if (card) {
        setCandidateState(candidate.id, { ...card, instruction: "", busy: null, localError: null });
      } else {
        setCandidateState(candidate.id, { instruction: "", busy: null });
        await loadCandidates();
      }
    } catch (e) {
      setCandidateState(candidate.id, {
        busy: null,
        localError: e instanceof Error ? e.message : "AI request failed",
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
        localError: e instanceof Error ? e.message : "Confirm failed",
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
        localError: e instanceof Error ? e.message : "Discard failed",
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
          className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
          onClick={closePanel}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="card-composer-title"
          className="relative z-[101] flex max-h-[min(94vh,900px)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl ring-1 ring-black/5 dark:ring-white/10"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <span id="card-composer-title" className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                New
              </span>
              <h3 className="truncate text-base font-semibold">{problemTitle}</h3>
            </div>
            <Button variant="ghost" size="sm" onClick={closePanel} disabled={!!busy} className="text-muted">
              Close
            </Button>
          </div>

          <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr]">
            <div className="border-b border-border px-5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <ModeButton active={mode === "manual"} onClick={() => setMode("manual")}>
                  Manual
                </ModeButton>
                <ModeButton active={mode === "ai"} onClick={() => setMode("ai")}>
                  AI candidates
                  {candidateCount > 0 && (
                    <span className="ml-1 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">
                      {candidateCount}
                    </span>
                  )}
                </ModeButton>
              </div>
            </div>

            <div className="min-h-0 overflow-y-auto px-5 py-4">
              <ProblemContext description={problemDescription} />

              {mode === "manual" ? (
                <div className="mt-4 space-y-4">
                  <div className="grid gap-3">
                    <CardTextarea label="Question" value={question} onChange={setQuestion} rows={3} disabled={!!busy} />
                    <CardTextarea label="Answer" value={answer} onChange={setAnswer} rows={5} disabled={!!busy} />
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
                    {error && <span className="mr-auto text-xs text-danger">{error}</span>}
                    <Button size="sm" disabled={!!busy} onClick={closePanel}>
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={!!busy || !question.trim() || !answer.trim()}
                      onClick={saveManualCard}
                    >
                      {busy === "save" ? "Saving..." : "Save card"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  <Surface className="space-y-3 p-3">
                    <CardTextarea
                      label="Raw note for one candidate"
                      value={rawText}
                      onChange={(value) => setRawText(value.slice(0, 6000))}
                      rows={4}
                      disabled={!!busy}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-muted">{rawText.length}/6000</span>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="primary" size="sm" disabled={!!busy} onClick={() => startAiGenerate("auto")}>
                          {busy === "auto" ? "Generating..." : "Auto generate"}
                        </Button>
                        <Button
                          size="sm"
                          disabled={!!busy || !rawText.trim()}
                          onClick={() => startAiGenerate("note")}
                        >
                          {busy === "note" ? "Generating..." : "Generate from note"}
                        </Button>
                      </div>
                    </div>
                    {generatingAi && <CardGenerationTimer elapsedSeconds={generationElapsedSeconds} />}
                  </Surface>

                  {error && <p className="rounded-md border border-danger/30 bg-danger/10 p-2 text-xs text-danger">{error}</p>}

                  {candidateCount === 0 ? (
                    <Surface className="p-8 text-center">
                      <p className="text-sm text-muted">No candidates waiting.</p>
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
          </div>
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
          void loadCandidates().catch((e) => setError(e instanceof Error ? e.message : "Could not load candidates"));
        }}
      >
        <span aria-hidden className="text-base leading-none">+</span>
        Add card
        {candidateCount > 0 ? (
          <span className="rounded bg-white/20 px-1.5 py-0.5 text-[10px]">{candidateCount}</span>
        ) : null}
      </Button>
      {modal}
    </div>
  );
}

function useElapsedSeconds(active: boolean, startedAt: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active || !startedAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, startedAt]);
  if (!active || !startedAt) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

function formatElapsedSeconds(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function CardGenerationTimer({ elapsedSeconds }: { elapsedSeconds: number }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted tabular-nums">
      <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      <span>
        Generating {formatElapsedSeconds(elapsedSeconds)} / {formatElapsedSeconds(CARD_GENERATION_TARGET_SECONDS)}
      </span>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-3 py-1.5 text-xs font-medium transition",
        active ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:bg-subtle hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function ProblemContext({ description }: { description?: string | null }) {
  return (
    <details className="rounded-md border border-border bg-subtle/40">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted">
        Problem statement
      </summary>
      <div className="max-h-72 overflow-auto border-t border-border px-3 py-3">
        {description?.trim() ? <Markdown>{description}</Markdown> : <p className="text-sm text-muted">No statement captured.</p>}
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
  const disabled = !!candidate.busy;
  return (
    <Surface className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Pill tone={candidate.aiStatus === "failed" ? "danger" : "success"}>
            {candidate.aiStatus === "failed" ? "failed" : "candidate"}
          </Pill>
          <span className="text-xs text-muted">
            {index + 1} / {count}
          </span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={index === 0} onClick={onPrev} className="px-2 py-1">
            Prev
          </Button>
          <Button size="sm" disabled={index >= count - 1} onClick={onNext} className="px-2 py-1">
            Next
          </Button>
        </div>
      </div>

      {candidate.errorMessage && (
        <p className="rounded-md border border-danger/30 bg-danger/10 p-2 text-xs text-danger">
          {candidate.errorMessage}
        </p>
      )}

      <CardTextarea
        label="Question"
        value={candidate.question}
        disabled={disabled}
        onChange={(question) => onChange({ question })}
        rows={3}
      />
      <CardTextarea
        label="Answer"
        value={candidate.answer}
        disabled={disabled}
        onChange={(answer) => onChange({ answer })}
        rows={5}
      />

      <div className="rounded-md border border-border bg-subtle/50 p-2">
        <CardTextarea
          label="Follow up"
          value={candidate.instruction}
          disabled={disabled}
          onChange={(instruction) => onChange({ instruction })}
          rows={2}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={disabled || !candidate.question.trim() || !candidate.answer.trim() || !candidate.instruction.trim()}
            onClick={onFollowup}
          >
            {candidate.busy === "followup" ? "Applying..." : "Apply follow up"}
          </Button>
        </div>
        {candidate.busy === "followup" && <CardGenerationTimer elapsedSeconds={followupElapsedSeconds} />}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
        {candidate.localError && <span className="mr-auto text-xs text-danger">{candidate.localError}</span>}
        <Button size="sm" disabled={disabled && candidate.busy !== "discard"} onClick={onDiscard}>
          {candidate.busy === "discard" ? "Discarding..." : "Discard"}
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={disabled || !candidate.question.trim() || !candidate.answer.trim()}
          onClick={onConfirm}
        >
          {candidate.busy === "confirm" ? "Confirming..." : "Confirm"}
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
    <label className="block text-[10px] font-medium uppercase tracking-wide text-muted">
      {label}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="mt-1 w-full resize-y rounded-lg border border-border bg-subtle p-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60"
        disabled={disabled}
      />
    </label>
  );
}

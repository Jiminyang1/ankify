"use client";

import { useState } from "react";
import { ChevronUp, X } from "lucide-react";
import type { PatternSuggestionDto, PracticeSessionDto, ReviewRateResponseDto } from "@ankify/contracts";
import type { FsrsRating } from "@ankify/core";
import { useLanguage } from "@/components/LanguageProvider";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { PatternSuggestion } from "@/components/same-pattern";
import { Spinner } from "@/components/ui/spinner";
import { weaknessCategoryName } from "@/lib/weakness-names";
import { notifyPracticeUpdated } from "@/lib/agent-events";
import { notifyReviewQueueUpdated } from "@/lib/review-queue-event";
import { cn } from "@/lib/utils";

type Target = PracticeSessionDto["targets"][number];
type TargetState = "correct" | "partial" | "missed" | "skipped" | "probing" | "open";

const MARK: Record<TargetState, string> = {
  correct: "border-success bg-success",
  partial: "border-warning bg-warning",
  missed: "border-danger bg-danger",
  skipped: "border-dashed border-muted",
  probing: "border-accent bg-[linear-gradient(90deg,rgb(var(--accent))_50%,transparent_50%)]",
  open: "border-muted",
};

/**
 * A talk-through practice session (docs/coach-practice.md, version 3) as a tray
 * on top of the Coach's composer: one line with the questions as dots and the
 * progress, opening into each question's grade and, once settled, its key
 * points as said or not. The chat above is where the questions are asked.
 */
export function PracticeTray({
  session,
  onChange,
  onClose,
  showRating,
  busy: turnBusy,
}: {
  session: PracticeSessionDto;
  onChange: (session: PracticeSessionDto | null) => void;
  onClose: () => void;
  /** False on the review page, whose rating bar takes the suggestion instead. */
  showRating: boolean;
  /** A Coach turn is running (it may be writing the Solutions doc). */
  busy: boolean;
}) {
  const { language, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState<FsrsRating | null>(session.suggestedRating);
  const [rated, setRated] = useState<FsrsRating | null>(null);
  const [suggestion, setSuggestion] = useState<PatternSuggestionDto | null>(null);
  const completed = session.status === "completed";
  const ratingLabels = [t.rating.again, t.rating.hard, t.rating.good, t.rating.easy];

  // A session that just finished opens so its summary and rating show.
  const [seenCompleted, setSeenCompleted] = useState(completed);
  if (completed && !seenCompleted) {
    setSeenCompleted(true);
    setOpen(true);
    setRating((current) => current ?? session.suggestedRating);
  }

  async function post(path: string, body: unknown) {
    setBusy(path);
    setError(null);
    try {
      const res = await fetch(`/api/practice/${encodeURIComponent(session.id)}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as { session?: PracticeSessionDto; message?: string } | null;
      if (!res.ok || !json?.session) throw new Error(json?.message ?? t.practice.actionFailed);
      notifyPracticeUpdated(json.session);
      return json.session;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t.practice.actionFailed);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function end() {
    const next = await post("end", {});
    setConfirmEnd(false);
    if (next) onChange(next.status === "abandoned" ? null : next);
  }

  async function dispute(targetId: string) {
    const next = await post("dispute", { targetId });
    if (!next) return;
    onChange(next);
    // A finished session was scored again.
    if (next.status === "completed" && !rated) setRating(next.suggestedRating);
  }

  async function rate() {
    if (!rating || busy) return;
    setBusy("rate");
    setError(null);
    try {
      const res = await fetch("/api/review/rate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ problemId: session.problemId, rating, requestId: crypto.randomUUID() }),
      });
      if (!res.ok) throw new Error(t.practice.actionFailed);
      const body = (await res.json().catch(() => null)) as Partial<ReviewRateResponseDto> | null;
      setRated(rating);
      setSuggestion(body?.suggestion ?? null);
      notifyReviewQueueUpdated(body?.queue?.dueCount);
    } catch (rateError) {
      setError(rateError instanceof Error ? rateError.message : t.practice.actionFailed);
    } finally {
      setBusy(null);
    }
  }

  const graded = session.targets.filter((target) => target.grade);
  const correct = graded.filter((target) => target.grade!.grade === "correct").length;
  const partial = graded.filter((target) => target.grade!.grade === "partial").length;
  const openTarget = session.targets.find((target) => !target.grade);
  // The approach question has no Solutions doc to be judged against yet: the
  // first turn is writing it, or writing it failed.
  const unjudgedApproach =
    !completed && openTarget?.kind === "core" && !openTarget.judged && openTarget.nudges === 0 && !openTarget.grade;
  const keyNote = unjudgedApproach ? (turnBusy ? t.practice.preparingKey : t.practice.notJudged) : null;
  const pointsNow =
    !completed && openTarget?.progress && openTarget.progress.covered > 0 ? openTarget.progress : null;
  const stateOf = (target: Target): TargetState =>
    target.grade?.grade ?? (completed ? "skipped" : target.nudges > 0 ? "probing" : "open");
  const settledText = (target: Target) => {
    if (!target.grade) return null;
    const how =
      target.settledBy === "complete"
        ? t.practice.settledBy.complete[target.help]
        : target.settledBy === "new_approach"
          ? t.practice.settledBy.newApproach
          : target.settledBy === "gave_up"
            ? t.practice.settledBy.gaveUp
            : target.settledBy === "not_recalled"
              ? t.practice.settledBy.notRecalled
              : target.grade.reason;
    return `${t.practice.grades[target.grade.grade]} · ${how}`;
  };
  const targetTitle = (target: Target) =>
    target.kind === "core"
      ? target.label === "complexity"
        ? t.practice.core.complexity
        : t.practice.core.approach
      : weaknessTitle(target, language);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-subtle/60">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={open}
          title={open ? t.practice.hideDetails : t.practice.showDetails}
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronUp
            aria-hidden
            className={cn("h-3.5 w-3.5 shrink-0 text-muted transition-transform", !open && "rotate-180")}
          />
          <span className="text-xs font-semibold text-fg">{t.practice.title}</span>
          <span className="flex items-center gap-1" aria-hidden>
            {session.targets.map((target) => (
              <span key={target.id} className={cn("h-2 w-2 rounded-full border", MARK[stateOf(target)])} />
            ))}
          </span>
          <span className="ml-auto truncate text-[11px] text-muted tabular-nums">
            {completed
              ? t.practice.score(correct, partial, graded.length)
              : t.practice.progress(graded.length, session.targets.length)}
            {pointsNow && ` · ${t.practice.pointsProgress(pointsNow.covered, pointsNow.total)}`}
          </span>
        </button>
        {!completed && !confirmEnd && (
          <Button
            size="xs"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => {
              setConfirmEnd(true);
              setOpen(true);
            }}
          >
            {t.practice.end}
          </Button>
        )}
        {completed && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t.practice.close}
            title={t.practice.close}
            className="rounded p-0.5 text-muted transition-colors hover:text-fg"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>

      {keyNote && !open && (
        <p className="flex items-center gap-1.5 border-t border-border px-3 py-1.5 text-[11px] text-muted">
          {turnBusy && <Spinner />}
          {keyNote}
        </p>
      )}

      {open && (
        <div className="max-h-[45vh] space-y-3 overflow-y-auto border-t border-border px-3 py-3">
          {keyNote && (
            <p className="flex items-center gap-1.5 text-[11px] text-muted">
              {turnBusy && <Spinner />}
              {keyNote}
            </p>
          )}
          <ul className="space-y-2.5">
            {session.targets.map((target) => {
              const state = stateOf(target);
              return (
                <li key={target.id} className="flex gap-2 text-xs leading-relaxed">
                  <span aria-hidden className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full border", MARK[state])} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-fg">{targetTitle(target)}</p>
                    {target.kind === "weakness" && <p className="text-muted">{target.label}</p>}
                    <p className="italic text-muted">
                      {target.grade
                        ? settledText(target)
                        : state === "skipped"
                          ? t.practice.grades.skipped
                          : target.progress && target.progress.covered > 0
                            ? t.practice.pointsProgress(target.progress.covered, target.progress.total)
                            : state === "probing"
                              ? t.practice.followingUp
                              : null}
                    </p>
                    {target.kind === "core" && target.review && target.review.points.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {target.review.approach && (
                          <p className="text-[11px] text-muted">{t.practice.checkedAgainst(target.review.approach)}</p>
                        )}
                        {target.review.points.map((point, index) => (
                          <div
                            key={index}
                            className={cn("flex gap-1.5", point.covered ? "text-fg" : "text-muted")}
                          >
                            <span
                              role="img"
                              aria-label={point.covered ? t.practice.covered : t.practice.notCovered}
                              className={cn(
                                "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full border",
                                point.covered ? "border-success bg-success" : "border-danger",
                              )}
                            />
                            <div className="min-w-0 [&_p]:inline [&_p]:text-xs">
                              <Markdown className="inline">{point.text}</Markdown>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {target.canDispute && (
                      <button
                        type="button"
                        disabled={busy !== null}
                        title={t.practice.disputeHint}
                        onClick={() => void dispute(target.id)}
                        className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline disabled:opacity-50"
                      >
                        {busy === "dispute" && <Spinner />}
                        {t.practice.dispute}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {completed ? (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-xs font-semibold text-fg">
                {t.practice.score(correct, partial, graded.length)}
                {session.endedEarly && <span className="font-normal text-muted"> · {t.practice.endedEarly}</span>}
              </p>
              {!showRating ? (
                <p className="text-[11px] text-muted">{t.practice.rateOnLeft}</p>
              ) : rated ? (
                <>
                  <p className="text-[11px] text-muted">{t.practice.rated(ratingLabels[rated - 1]!)}</p>
                  {suggestion && <PatternSuggestion suggestion={suggestion} className="mt-2" />}
                </>
              ) : (
                <div className="flex items-stretch gap-1.5" role="radiogroup" aria-label={t.practice.rate}>
                  {([1, 2, 3, 4] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={rating === value}
                      onClick={() => setRating(value)}
                      className={cn(
                        "flex-1 rounded-md border px-1.5 py-1 text-center text-[11px] font-semibold transition hover:bg-subtle",
                        rating === value ? "border-accent bg-accent-soft/30 ring-1 ring-accent/30" : "border-border bg-surface",
                      )}
                    >
                      {ratingLabels[value - 1]}
                      <span className="block text-[9px] font-normal text-muted">
                        {session.suggestedRating === value ? t.practice.suggested : " "}
                      </span>
                    </button>
                  ))}
                  <Button size="sm" variant="primary" disabled={!rating || busy !== null} onClick={() => void rate()} className="h-auto">
                    {busy === "rate" ? <Spinner /> : t.review.submit}
                  </Button>
                </div>
              )}
            </div>
          ) : confirmEnd ? (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-xs text-muted">{t.practice.endConfirm}</p>
              <div className="flex gap-2">
                <Button size="xs" disabled={busy !== null} onClick={() => setConfirmEnd(false)}>
                  {t.practice.keepGoing}
                </Button>
                <Button size="xs" variant="danger" disabled={busy !== null} onClick={() => void end()}>
                  {busy === "end" && <Spinner />}
                  {t.practice.endNow}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-muted">{t.practice.hint}</p>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}

function weaknessTitle(target: Target, language: "en" | "zh") {
  return target.category ? weaknessCategoryName(target.category, null, language) : target.label;
}

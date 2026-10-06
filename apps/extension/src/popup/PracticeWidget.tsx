import { useCallback, useEffect, useRef, useState } from "react";
import type { PracticeSessionDto } from "@ankify/contracts";
import type { ExtSettings } from "../shared/messages";
import { apiFetch } from "./api";
import { PopupMarkdown } from "./PopupMarkdown";

export type PracticeCopy = {
  title: string;
  talkHint: string;
  talkScore: (correct: number, partial: number, total: number) => string;
  core: { approach: string; complexity: string };
  grades: { correct: string; partial: string; missed: string; skipped: string };
  end: string;
  endConfirm: string;
  endNow: string;
  keepGoing: string;
  endedEarly: string;
  abandoned: string;
  showDetails: string;
  hideDetails: string;
  close: string;
  startMessage: string;
  progress: (done: number, total: number) => string;
  showAnswer: string;
  gotIt: string;
  missed: string;
  preparing: string;
  noQuestions: (reason: string) => string;
  next: string;
  correct: string;
  incorrect: string;
  score: (points: number, total: number) => string;
  /** Marks the suggested rating's button. */
  suggestedTag: string;
  rate: string;
  rated: (rating: string) => string;
  ratings: [string, string, string, string];
  loadFailed: string;
  actionFailed: string;
};

type Rating = 1 | 2 | 3 | 4;

/** One practice session inside the Coach chat (docs/coach-practice.md):
 *  cards to recall, generated questions graded by the server, then a
 *  suggested rating. Talks to the practice API directly; no model calls. */
export function PracticeWidget({
  settings,
  sessionId,
  initial,
  copy,
  onCompleted,
  onRated,
  onAbandoned,
  variant = "card",
  onClose,
  categoryName,
}: {
  settings: ExtSettings;
  sessionId: string;
  initial?: PracticeSessionDto;
  copy: PracticeCopy;
  /** Fires once when the session first reaches its summary. */
  onCompleted: (session: PracticeSessionDto) => void;
  onRated: () => void;
  /** The user ended it with nothing answered, so it was dropped. */
  onAbandoned: (session: PracticeSessionDto) => void;
  /** "tray": a one-line bar attached above the composer that expands on
   *  click (talk-throughs). "card": the full card in the chat. */
  variant?: "card" | "tray";
  /** Closes a finished tray. */
  onClose?: () => void;
  /** Display name for a weakness category key. */
  categoryName: (key: string) => string;
}) {
  const [session, setSession] = useState<PracticeSessionDto | null>(initial ?? null);
  const [revealed, setRevealed] = useState(false);
  /** The question whose feedback is on screen until "Next". */
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState<Rating | null>(null);
  const [rated, setRated] = useState<Rating | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [open, setOpen] = useState(false);
  // A finished talk-through opens its tray so the summary and rating show.
  const finished = session?.status === "completed";
  useEffect(() => {
    if (finished) setOpen(true);
  }, [finished]);
  const completedReported = useRef(false);

  const load = useCallback(async () => {
    const res = await apiFetch(settings, `/api/practice/${sessionId}`, { cache: "no-store" });
    if (!res.ok) throw new Error(copy.loadFailed);
    setSession(((await res.json()) as { session: PracticeSessionDto }).session);
  }, [copy.loadFailed, sessionId, settings]);

  useEffect(() => {
    if (!initial) void load().catch((loadError) => setError(loadError instanceof Error ? loadError.message : copy.loadFailed));
  }, [copy.loadFailed, initial, load]);

  // Questions are generated in the background; check until they're ready.
  // A talk-through is graded by the Coach in the chat; follow its progress.
  const pending =
    session?.status === "active" && (session.check.status === "pending" || session.mode === "talk");
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => void load().catch(() => {}), 1_500);
    return () => window.clearInterval(timer);
  }, [load, pending]);

  useEffect(() => {
    if (!session || session.status !== "completed" || completedReported.current) return;
    completedReported.current = true;
    setRating(session.suggestedRating);
    // Feedback for the last question stays visible until "Next".
    if (!feedbackFor) onCompleted(session);
  }, [feedbackFor, onCompleted, session]);

  async function post(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(settings, `/api/practice/${sessionId}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as { session?: PracticeSessionDto; error?: string } | null;
      if (!res.ok || !json?.session) throw new Error(json?.error ?? copy.actionFailed);
      setSession(json.session);
      return json.session;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : copy.actionFailed);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function end() {
    const next = await post("end", {});
    setConfirmEnd(false);
    if (next?.status === "abandoned") onAbandoned(next);
  }

  async function rate() {
    if (!session || !rating || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(settings, "/api/review/rate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ problemId: session.problemId, rating, requestId: crypto.randomUUID() }),
      });
      if (!res.ok) throw new Error(copy.actionFailed);
      setRated(rating);
      onRated();
    } catch (rateError) {
      setError(rateError instanceof Error ? rateError.message : copy.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  if (!session) {
    return (
      <div className="practice">
        {error ? <p className="coach-run-error">{error}</p> : <p className="popup-muted coach-thinking"><span className="btn-spinner" /></p>}
      </div>
    );
  }

  // Same look as the panel's quick rating: four plain buttons and a check.
  // The suggested one is marked under its label instead of a separate line.
  const ratingBlock = rated ? (
    <p className="popup-muted">{copy.rated(copy.ratings[rated - 1]!)}</p>
  ) : (
    <div className="rate-row" role="radiogroup" aria-label={copy.rate}>
      {([1, 2, 3, 4] as const).map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={rating === value}
          className={`rate-btn rate-btn-flat${rating === value ? " rate-btn-active" : ""}`}
          onClick={() => setRating(value)}
        >
          <span className="rate-btn-label">{copy.ratings[value - 1]}</span>
          <span className="rate-btn-interval">{session.suggestedRating === value ? copy.suggestedTag : "\u00a0"}</span>
        </button>
      ))}
      <button
        type="button"
        className="btn btn-primary rate-submit-inline"
        disabled={!rating || busy}
        aria-label={copy.rate}
        title={copy.rate}
        onClick={() => void rate()}
      >
        {busy ? (
          <span className="btn-spinner" />
        ) : (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="m3.5 8.5 3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    </div>
  );

  if (session.mode === "talk") {
    const graded = session.targets.filter((target) => target.grade);
    const correct = graded.filter((target) => target.grade!.grade === "correct").length;
    const partial = graded.filter((target) => target.grade!.grade === "partial").length;
    const active = session.status === "active";
    const tray = variant === "tray";
    const stateOf = (target: PracticeSessionDto["targets"][number]) =>
      target.grade?.grade ?? (session.status === "completed" ? "skipped" : "open");
    if (session.status === "abandoned") {
      return (
        <div className="practice practice-talk practice-ended">
          <div className="practice-head">
            <span className="coach-dock-title">{copy.title}</span>
          </div>
          <p className="popup-muted practice-talk-hint">{copy.abandoned}</p>
        </div>
      );
    }
    const endButton =
      active && !confirmEnd ? (
        <button
          type="button"
          className="practice-end"
          disabled={busy}
          onClick={() => {
            setConfirmEnd(true);
            setOpen(true);
          }}
        >
          {copy.end}
        </button>
      ) : null;
    const details = (
      <>
        <ul className="practice-targets">
          {session.targets.map((target) => {
            const state = stateOf(target);
            return (
              <li key={target.id} className="practice-target" data-grade={state}>
                <span className="practice-target-mark" aria-hidden="true" />
                <span className="practice-target-text">
                  <span className="practice-target-kind">
                    {target.kind === "core"
                      ? target.label === "complexity"
                        ? copy.core.complexity
                        : copy.core.approach
                      : categoryName(target.category ?? target.label)}
                  </span>
                  {target.kind === "weakness" && <span className="practice-target-label">{target.label}</span>}
                  {target.grade ? (
                    <span className="practice-target-grade">
                      {copy.grades[target.grade.grade]} · {target.grade.reason}
                    </span>
                  ) : state === "skipped" ? (
                    <span className="practice-target-grade">{copy.grades.skipped}</span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
        {session.status === "completed" ? (
          <div className="practice-summary">
            <p className="practice-score">
              {copy.talkScore(correct, partial, graded.length)}
              {session.endedEarly && <span className="popup-muted"> · {copy.endedEarly}</span>}
            </p>
            {ratingBlock}
          </div>
        ) : confirmEnd ? (
          <div className="practice-confirm">
            <p className="popup-muted">{copy.endConfirm}</p>
            <div className="practice-actions">
              <button type="button" className="btn-xs" disabled={busy} onClick={() => setConfirmEnd(false)}>
                {copy.keepGoing}
              </button>
              <button type="button" className="btn-xs btn-xs-danger" disabled={busy} onClick={() => void end()}>
                {busy && <span className="btn-spinner" />}
                {copy.endNow}
              </button>
            </div>
          </div>
        ) : (
          <p className="popup-muted practice-talk-hint">{copy.talkHint}</p>
        )}
        {error && <p className="coach-run-error">{error}</p>}
      </>
    );

    if (tray) {
      return (
        <div className="practice-tray" data-open={open}>
          <div className="practice-tray-bar">
            <button
              type="button"
              className="practice-tray-toggle"
              aria-expanded={open}
              title={open ? copy.hideDetails : copy.showDetails}
              onClick={() => setOpen((value) => !value)}
            >
              <svg className="practice-tray-chevron" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="m4 10 4-4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="practice-tray-title">{copy.title}</span>
              <span className="practice-tray-dots" aria-hidden="true">
                {session.targets.map((target) => (
                  <span key={target.id} className="practice-tray-dot" data-grade={stateOf(target)} />
                ))}
              </span>
              <span className="practice-progress">
                {session.status === "completed"
                  ? copy.talkScore(correct, partial, graded.length)
                  : copy.progress(graded.length, session.targets.length)}
              </span>
            </button>
            {endButton}
            {session.status === "completed" && onClose && (
              <button type="button" className="practice-tray-close" aria-label={copy.close} title={copy.close} onClick={onClose}>
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
          {open && <div className="practice-tray-body scroll-area">{details}</div>}
        </div>
      );
    }

    return (
      <div className="practice practice-talk">
        <div className="practice-head">
          <span className="coach-dock-title">{copy.title}</span>
          <span className="practice-head-side">
            <span className="practice-progress">{copy.progress(graded.length, session.targets.length)}</span>
            {endButton}
          </span>
        </div>
        {details}
      </div>
    );
  }

  const checkItems = session.check.status === "ready" ? session.check.items : [];
  const total = session.recall.length + (session.check.status === "ready" || pending ? 3 : 0);
  const done =
    session.recall.filter((card) => card.result).length + checkItems.filter((item) => item.answer).length;
  const points =
    session.recall.filter((card) => card.result === "got_it").length +
    checkItems.filter((item) => item.answer?.correct).length;
  const recallCard = session.recall.find((card) => !card.result);
  const feedbackItem = feedbackFor ? checkItems.find((item) => item.id === feedbackFor) : undefined;
  const question = checkItems.find((item) => !item.answer);
  const showSummary = session.status === "completed" && !feedbackItem;

  return (
    <div className="practice">
      <div className="practice-head">
        <span className="coach-dock-title">{copy.title}</span>
        {!showSummary && <span className="practice-progress">{copy.progress(done, total)}</span>}
      </div>

      {showSummary ? (
        <div className="practice-summary">
          <p className="practice-score">{copy.score(points, session.recall.length + checkItems.length)}</p>
          {(session.check.status === "failed" || session.check.status === "skipped") && session.check.message && (
            <p className="popup-muted">{copy.noQuestions(session.check.message)}</p>
          )}
          {ratingBlock}
        </div>
      ) : recallCard ? (
        <div className="practice-card">
          <PopupMarkdown className="practice-prompt">{recallCard.prompt}</PopupMarkdown>
          {revealed ? (
            <>
              <div className="practice-answer">
                <PopupMarkdown>{recallCard.answer}</PopupMarkdown>
              </div>
              <div className="practice-actions">
                <button
                  type="button"
                  className="btn-xs"
                  disabled={busy}
                  onClick={() => void post("recall", { key: recallCard.key, result: "missed" }).then(() => setRevealed(false))}
                >
                  {copy.missed}
                </button>
                <button
                  type="button"
                  className="btn-xs btn-xs-accent"
                  disabled={busy}
                  onClick={() => void post("recall", { key: recallCard.key, result: "got_it" }).then(() => setRevealed(false))}
                >
                  {copy.gotIt}
                </button>
              </div>
            </>
          ) : (
            <button type="button" className="btn btn-secondary btn-inline" onClick={() => setRevealed(true)}>
              {copy.showAnswer}
            </button>
          )}
        </div>
      ) : feedbackItem?.answer ? (
        <div className="practice-card">
          <PopupMarkdown className="practice-prompt">{feedbackItem.question}</PopupMarkdown>
          <p className={feedbackItem.answer.correct ? "practice-verdict is-correct" : "practice-verdict is-wrong"}>
            {feedbackItem.answer.correct ? copy.correct : copy.incorrect}
          </p>
          {!feedbackItem.answer.correct && (
            <div className="practice-answer">
              <PopupMarkdown>{feedbackItem.choices[feedbackItem.answer.answerIndex] ?? ""}</PopupMarkdown>
            </div>
          )}
          <PopupMarkdown className="practice-explanation">{feedbackItem.answer.explanation}</PopupMarkdown>
          <button
            type="button"
            className="btn btn-secondary btn-inline"
            onClick={() => {
              setFeedbackFor(null);
              if (session.status === "completed") onCompleted(session);
            }}
          >
            {copy.next}
          </button>
        </div>
      ) : question ? (
        <div className="practice-card">
          <PopupMarkdown className="practice-prompt">{question.question}</PopupMarkdown>
          <div className="practice-choices">
            {question.choices.map((choice, index) => (
              <button
                key={index}
                type="button"
                className="practice-choice"
                disabled={busy}
                onClick={() =>
                  void post("check", { itemId: question.id, choice: index }).then((next) => {
                    if (next) setFeedbackFor(question.id);
                  })
                }
              >
                <span className="practice-choice-letter">{String.fromCharCode(65 + index)}</span>
                <PopupMarkdown className="popup-md-inline">{choice}</PopupMarkdown>
              </button>
            ))}
          </div>
        </div>
      ) : pending ? (
        <p className="popup-muted coach-thinking">
          <span className="btn-spinner" /> {copy.preparing}
        </p>
      ) : null}

      {error && <p className="coach-run-error">{error}</p>}
    </div>
  );
}

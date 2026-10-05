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
  grades: { correct: string; partial: string; missed: string };
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
  suggested: (rating: string) => string;
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
  categoryName,
}: {
  settings: ExtSettings;
  sessionId: string;
  initial?: PracticeSessionDto;
  copy: PracticeCopy;
  /** Fires once when the session first reaches its summary. */
  onCompleted: (session: PracticeSessionDto) => void;
  onRated: () => void;
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

  const ratingBlock = (
    <>
      {rated ? (
        <p className="popup-muted">{copy.rated(copy.ratings[rated - 1]!)}</p>
      ) : (
        <>
          {session.suggestedRating && (
            <p className="popup-muted">{copy.suggested(copy.ratings[session.suggestedRating - 1]!)}</p>
          )}
          <div className="practice-ratings" role="radiogroup" aria-label={copy.rate}>
            {([1, 2, 3, 4] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={rating === value}
                className="practice-rating"
                data-rating={value}
                data-active={rating === value}
                onClick={() => setRating(value)}
              >
                {copy.ratings[value - 1]}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-primary btn-inline" disabled={!rating || busy} onClick={() => void rate()}>
            {busy && <span className="btn-spinner" />}
            {copy.rate}
          </button>
        </>
      )}
    </>
  );

  if (session.mode === "talk") {
    const graded = session.targets.filter((target) => target.grade);
    const correct = graded.filter((target) => target.grade!.grade === "correct").length;
    const partial = graded.filter((target) => target.grade!.grade === "partial").length;
    return (
      <div className="practice practice-talk">
        <div className="practice-head">
          <span className="coach-dock-title">{copy.title}</span>
          <span className="practice-progress">{copy.progress(graded.length, session.targets.length)}</span>
        </div>
        <ul className="practice-targets">
          {session.targets.map((target) => (
            <li key={target.id} className="practice-target" data-grade={target.grade?.grade ?? "open"}>
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
                {target.grade && (
                  <span className="practice-target-grade">
                    {copy.grades[target.grade.grade]} · {target.grade.reason}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
        {session.status === "completed" ? (
          <div className="practice-summary">
            <p className="practice-score">{copy.talkScore(correct, partial, session.targets.length)}</p>
            {ratingBlock}
          </div>
        ) : (
          <p className="popup-muted practice-talk-hint">{copy.talkHint}</p>
        )}
        {error && <p className="coach-run-error">{error}</p>}
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

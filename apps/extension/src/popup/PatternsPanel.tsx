import { useCallback, useEffect, useState } from "react";
import type {
  PatternStepDto,
  PatternSuggestionDto,
  ProblemPatternDto,
  ProblemPatternsDto,
} from "@ankify/contracts";
import type { ExtSettings } from "../shared/messages";
import { apiFetch } from "./api";

export type PatternsCopy = {
  title: string;
  empty: string;
  loadFailed: string;
  actionFailed: string;
  progress: (done: number, total: number) => string;
  nextUp: string;
  allDone: string;
  showAll: (count: number) => string;
  showLess: string;
  tiers: { core: string; advanced: string; extension: string };
  ratingHint: string;
  premium: string;
  inReview: string;
  misc: string;
  mute: string;
  unmute: string;
  mutedNote: string;
  credit: string;
  source: string;
  suggestionTitle: string;
  suggestionBody: (pattern: string) => string;
  open: string;
  notThisPattern: string;
  suggestionMuted: string;
  close: string;
};

/** Shown before "Show all": enough to see where the ladder goes next. */
const NEXT_COUNT = 3;

function leetcodeUrl(slug: string) {
  return `https://leetcode.com/problems/${slug}/`;
}

async function setMuted(settings: ExtSettings, key: string, muted: boolean) {
  const res = await apiFetch(settings, "/api/patterns/mute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, muted }),
  });
  if (!res.ok) throw new Error("mute_failed");
}

/** The patterns this problem belongs to, from 灵茶山艾府's problem lists: each
 *  technique's ladder and what to try next. Works on any problem page, saved
 *  or not. */
export function PatternsPanel({
  settings,
  slug,
  copy,
}: {
  settings: ExtSettings;
  slug: string;
  copy: PatternsCopy;
}) {
  const [data, setData] = useState<ProblemPatternsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(settings, `/api/problems/by-slug/${encodeURIComponent(slug)}/patterns`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(copy.loadFailed);
      setData((await res.json()) as ProblemPatternsDto);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : copy.loadFailed);
    }
  }, [copy.loadFailed, settings, slug]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) {
    return error ? <div className="err-banner">{error}</div> : <div className="patterns-loading"><span className="btn-spinner" /></div>;
  }
  if (data.patterns.length === 0) return <p className="popup-muted">{copy.empty}</p>;

  // Real techniques first; "Other" sections are a mix.
  const patterns = [...data.patterns].sort((a, b) => Number(a.misc) - Number(b.misc));
  return (
    <div className="patterns-panel">
      {patterns.map((pattern) => (
        <PatternCard
          key={pattern.key}
          settings={settings}
          pattern={pattern}
          currentSlug={slug}
          copy={copy}
          onMutedChange={(muted) =>
            setData((current) =>
              current && {
                ...current,
                patterns: current.patterns.map((item) => (item.key === pattern.key ? { ...item, muted } : item)),
              },
            )
          }
        />
      ))}
      <p className="patterns-credit">{copy.credit}</p>
    </div>
  );
}

function PatternCard({
  settings,
  pattern,
  currentSlug,
  copy,
  onMutedChange,
}: {
  settings: ExtSettings;
  pattern: ProblemPatternDto;
  currentSlug: string;
  copy: PatternsCopy;
  onMutedChange: (muted: boolean) => void;
}) {
  const language = settings.language === "zh" ? "zh" : "en";
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = pattern.steps.filter((step) => !step.done && step.slug !== currentSlug).slice(0, NEXT_COUNT);
  const shown = expanded ? pattern.steps : next;

  async function toggleMuted() {
    setBusy(true);
    setError(null);
    try {
      await setMuted(settings, pattern.key, !pattern.muted);
      onMutedChange(!pattern.muted);
    } catch {
      setError(copy.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pattern-card">
      <div className="pattern-card-head">
        <div className="pattern-card-titles">
          <span className="pattern-topic">
            {pattern.topic.name[language]} ·{" "}
            <a href={pattern.topic.sourceUrl} target="_blank" rel="noreferrer">
              {copy.source}
            </a>
          </span>
          <span className="pattern-name">{pattern.name[language]}</span>
        </div>
        <span className="pattern-progress">{copy.progress(pattern.done, pattern.total)}</span>
      </div>
      {!expanded && <p className="pattern-label">{copy.nextUp}</p>}
      {shown.length === 0 ? (
        <p className="popup-muted">{copy.allDone}</p>
      ) : (
        <ul className="pattern-steps">
          {shown.map((step) => (
            <StepRow key={step.slug} step={step} current={step.slug === currentSlug} copy={copy} />
          ))}
        </ul>
      )}
      <div className="pattern-card-foot">
        {pattern.steps.length > next.length && (
          <button type="button" className="btn-link" onClick={() => setExpanded((value) => !value)}>
            {expanded ? copy.showLess : copy.showAll(pattern.steps.length)}
          </button>
        )}
        <span className="pattern-spacer" />
        {pattern.misc ? (
          <span className="popup-muted">{copy.misc}</span>
        ) : (
          <button type="button" className="btn-xs" disabled={busy} title={pattern.muted ? copy.mutedNote : undefined} onClick={() => void toggleMuted()}>
            {busy && <span className="btn-spinner" />}
            {pattern.muted ? copy.unmute : copy.mute}
          </button>
        )}
      </div>
      {error && <div className="err-banner">{error}</div>}
    </section>
  );
}

function StepRow({ step, current, copy }: { step: PatternStepDto; current: boolean; copy: PatternsCopy }) {
  return (
    <li className={`pattern-step${current ? " is-current" : ""}`}>
      <span className={`pattern-dot${step.done ? " is-done" : ""}`} aria-hidden="true" />
      <a className="pattern-step-title" href={leetcodeUrl(step.slug)} target="_blank" rel="noreferrer">
        <span className="pattern-step-num">{step.id}. </span>
        {step.title}
      </a>
      {step.tier !== "core" && <span className="pill">{copy.tiers[step.tier]}</span>}
      {step.premium && <span className="pill pill-due">{copy.premium}</span>}
      {step.problemId && <span className="pill pill-review">{copy.inReview}</span>}
      <span className="pattern-rating" title={copy.ratingHint}>
        {step.rating ?? ""}
      </span>
    </li>
  );
}

/** After a rating: one new problem with the technique the user just showed
 *  they remember. */
export function PatternSuggestionCard({
  settings,
  suggestion,
  copy,
  onClose,
}: {
  settings: ExtSettings;
  suggestion: PatternSuggestionDto;
  copy: PatternsCopy;
  onClose?: () => void;
}) {
  const language = settings.language === "zh" ? "zh" : "en";
  const [muted, setMutedState] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { problem, pattern } = suggestion;

  async function mute() {
    setBusy(true);
    setError(null);
    try {
      await setMuted(settings, pattern.key, true);
      setMutedState(true);
    } catch {
      setError(copy.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  if (muted) {
    return (
      <div className="pattern-suggestion">
        <p className="popup-muted">{copy.suggestionMuted}</p>
        {onClose && (
          <button type="button" className="btn-xs" onClick={onClose}>
            {copy.close}
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="pattern-suggestion">
      <p className="pattern-suggestion-title">{copy.suggestionTitle}</p>
      <p className="popup-muted">{copy.suggestionBody(pattern.name[language])}</p>
      <a className="pattern-step pattern-suggestion-problem" href={leetcodeUrl(problem.slug)} target="_blank" rel="noreferrer">
        <span className="pattern-step-title">
          <span className="pattern-step-num">{problem.id}. </span>
          {problem.title}
        </span>
        {problem.rating != null && (
          <span className="pattern-rating" title={copy.ratingHint}>
            {problem.rating}
          </span>
        )}
      </a>
      <div className="pattern-card-foot">
        <a className="btn-xs btn-xs-accent" href={leetcodeUrl(problem.slug)} target="_blank" rel="noreferrer">
          {copy.open}
        </a>
        <button type="button" className="btn-xs" disabled={busy} onClick={() => void mute()}>
          {busy && <span className="btn-spinner" />}
          {copy.notThisPattern}
        </button>
        <span className="pattern-spacer" />
        {onClose && (
          <button type="button" className="weak-spot-remove" aria-label={copy.close} title={copy.close} onClick={onClose}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      {error && <div className="err-banner">{error}</div>}
    </div>
  );
}

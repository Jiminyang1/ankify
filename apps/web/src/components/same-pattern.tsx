"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type {
  PatternStepDto,
  PatternSuggestionDto,
  ProblemPatternDto,
  ProblemPatternsDto,
} from "@ankify/contracts";
import { useLanguage } from "@/components/LanguageProvider";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DifficultyPill, Pill } from "@/components/ui/pill";
import { Spinner } from "@/components/ui/spinner";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";

/** Shown before "Show all": enough to see where the ladder goes next. */
const NEXT_COUNT = 3;

function leetcodeUrl(slug: string) {
  return `https://leetcode.com/problems/${slug}/`;
}

async function setMuted(key: string, muted: boolean) {
  const res = await fetch("/api/patterns/mute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, muted }),
  });
  if (!res.ok) throw new Error("mute_failed");
}

/**
 * The patterns this problem belongs to, from 灵茶山艾府's problem lists: each
 * technique's ladder, how far the user is, and what to try next.
 */
export function SamePattern({ slug, className }: { slug: string; className?: string }) {
  const { t } = useLanguage();
  const [data, setData] = useState<ProblemPatternsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/problems/by-slug/${encodeURIComponent(slug)}/patterns`, { cache: "no-store" });
      if (!res.ok) throw new Error(t.patterns.loadFailed);
      setData((await res.json()) as ProblemPatternsDto);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.patterns.loadFailed);
    }
  }, [slug, t.patterns.loadFailed]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  if (!data) {
    return (
      <div className={cn("flex items-center justify-center py-10", className)}>
        {error ? <p className="text-sm text-danger">{error}</p> : <Spinner />}
      </div>
    );
  }
  if (data.patterns.length === 0) {
    return (
      <div className={className}>
        <EmptyState title={t.patterns.empty} />
      </div>
    );
  }

  // Real techniques first; "Other" sections are a mix.
  const patterns = [...data.patterns].sort((a, b) => Number(a.misc) - Number(b.misc));
  return (
    <div className={cn("space-y-3", className)}>
      {patterns.map((pattern) => (
        <PatternCard
          key={pattern.key}
          pattern={pattern}
          currentSlug={slug}
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
      <p className="text-[11px] text-muted">{t.patterns.credit}</p>
    </div>
  );
}

function PatternCard({
  pattern,
  currentSlug,
  onMutedChange,
}: {
  pattern: ProblemPatternDto;
  currentSlug: string;
  onMutedChange: (muted: boolean) => void;
}) {
  const { language, t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = pattern.steps.filter((step) => !step.done && step.slug !== currentSlug).slice(0, NEXT_COUNT);
  const shown = expanded ? pattern.steps : next;

  async function toggleMuted() {
    setBusy(true);
    setError(null);
    try {
      await setMuted(pattern.key, !pattern.muted);
      onMutedChange(!pattern.muted);
    } catch {
      setError(t.patterns.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Surface className="p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-muted">
            {pattern.topic.name[language]}
            {" · "}
            <a href={pattern.topic.sourceUrl} target="_blank" rel="noreferrer" className="hover:text-fg hover:underline">
              {t.patterns.source}
            </a>
          </p>
          <h3 className="mt-0.5 text-sm font-semibold text-fg">{pattern.name[language]}</h3>
        </div>
        <span className="shrink-0 pt-0.5 text-[11px] text-muted tabular-nums">
          {t.patterns.progress(pattern.done, pattern.total)}
        </span>
      </div>

      {!expanded && (
        <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted">{t.patterns.nextUp}</p>
      )}
      {shown.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{t.patterns.allDone}</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {shown.map((step) => (
            <StepRow key={step.slug} step={step} current={step.slug === currentSlug} />
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {pattern.steps.length > next.length && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="text-xs text-muted transition-colors hover:text-fg"
          >
            {expanded ? t.patterns.showLess : t.patterns.showAll(pattern.steps.length)}
          </button>
        )}
        <span className="flex-1" />
        {pattern.misc ? (
          <span className="text-[11px] text-muted">{t.patterns.misc}</span>
        ) : (
          <>
            {pattern.muted && <span className="text-[11px] text-muted">{t.patterns.mutedNote}</span>}
            <Button size="xs" variant="ghost" disabled={busy} onClick={() => void toggleMuted()}>
              {busy ? <Spinner /> : pattern.muted ? t.patterns.unmute : t.patterns.mute}
            </Button>
          </>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </Surface>
  );
}

function StepRow({ step, current }: { step: PatternStepDto; current: boolean }) {
  const { language, t } = useLanguage();
  const title = (
    <>
      <span className="text-muted tabular-nums">{step.id}. </span>
      {step.title}
    </>
  );
  return (
    <li
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
        current ? "bg-accent-soft" : "hover:bg-subtle",
      )}
    >
      <span
        aria-hidden
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", step.done ? "bg-success" : "bg-border")}
        title={step.done ? t.patterns.done : undefined}
      />
      {step.problemId ? (
        <Link href={`/problems/${step.problemId}`} className="min-w-0 flex-1 truncate text-fg hover:underline">
          {title}
        </Link>
      ) : (
        <a
          href={leetcodeUrl(step.slug)}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 flex-1 truncate text-fg hover:underline"
        >
          {title}
        </a>
      )}
      {step.tier !== "core" && <Pill>{t.patterns.tiers[step.tier]}</Pill>}
      {step.premium && <Pill tone="warning">{t.patterns.premium}</Pill>}
      {step.problemId && <Pill tone="success">{t.patterns.inReview}</Pill>}
      <DifficultyPill difficulty={step.difficulty} language={language} />
      <span className="w-[4.5rem] shrink-0 text-right text-[11px] text-muted tabular-nums" title={t.patterns.ratingHint}>
        {step.rating != null ? t.patterns.rating(step.rating) : ""}
      </span>
    </li>
  );
}

/**
 * After a rating: one new problem with the technique the user just showed
 * they remember. "Not this pattern" stops suggestions from it.
 */
export function PatternSuggestion({
  suggestion,
  className,
}: {
  suggestion: PatternSuggestionDto;
  className?: string;
}) {
  const { language, t } = useLanguage();
  const [muted, setMutedState] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { problem, pattern } = suggestion;

  async function mute() {
    setBusy(true);
    setError(null);
    try {
      await setMuted(pattern.key, true);
      setMutedState(true);
    } catch {
      setError(t.patterns.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  if (muted) {
    return <p className={cn("text-center text-xs text-muted", className)}>{t.patterns.suggestionMuted}</p>;
  }
  return (
    <Surface className={cn("p-4 text-left", className)}>
      <p className="text-sm font-semibold text-fg">{t.patterns.suggestionTitle}</p>
      <p className="mt-1 text-xs text-muted">{t.patterns.suggestionBody(pattern.name[language])}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-fg">
          <span className="text-muted tabular-nums">{problem.id}. </span>
          {problem.title}
        </span>
        <DifficultyPill difficulty={problem.difficulty} language={language} />
        {problem.rating != null && (
          <span className="text-[11px] text-muted tabular-nums" title={t.patterns.ratingHint}>
            {t.patterns.rating(problem.rating)}
          </span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          href={leetcodeUrl(problem.slug)}
          target="_blank"
          rel="noreferrer"
          className={buttonClasses({ variant: "primary", size: "sm" })}
        >
          {t.patterns.open}
        </a>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void mute()}>
          {busy ? <Spinner /> : t.patterns.notThisPattern}
        </Button>
        <span className="flex-1" />
        <a
          href={pattern.topic.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-muted hover:text-fg hover:underline"
        >
          {t.patterns.credit}
        </a>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </Surface>
  );
}

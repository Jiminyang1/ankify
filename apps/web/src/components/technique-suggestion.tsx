"use client";

import type { PatternRefDto, PatternStepDto, TechniqueSuggestionDto } from "@ankify/contracts";
import { useLanguage } from "@/components/LanguageProvider";
import { buttonClasses } from "@/components/ui/button";
import { DifficultyPill } from "@/components/ui/pill";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";

function leetcodeUrl(slug: string) {
  return `https://leetcode.com/problems/${slug}/`;
}

/**
 * After a review rated Again: one easier problem with the same technique,
 * from 灵茶山艾府's ladder (docs/product-main-line.md, "Same pattern,
 * re-anchored").
 */
export function EasierProblem({
  suggestion,
  compact,
  className,
}: {
  suggestion: TechniqueSuggestionDto;
  /** The narrow practice tray: smaller type, no outer card. */
  compact?: boolean;
  className?: string;
}) {
  const { language, t } = useLanguage();
  const { problem, technique } = suggestion;
  const body = (
    <>
      <p className={cn("font-semibold text-fg", compact ? "text-xs" : "text-sm")}>{t.patterns.easierTitle}</p>
      <p className={cn("mt-1 text-muted", compact ? "text-[11px]" : "text-xs")}>
        {t.patterns.easierBody(technique.name[language])}
      </p>
      <TechniqueStep step={problem} className="mt-3" />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          href={leetcodeUrl(problem.slug)}
          target="_blank"
          rel="noreferrer"
          className={buttonClasses({ variant: "primary", size: compact ? "xs" : "sm" })}
        >
          {t.patterns.open}
        </a>
        <span className="flex-1" />
        <TechniqueCredit technique={technique} />
      </div>
    </>
  );
  if (compact) return <div className={cn("text-left", className)}>{body}</div>;
  return <Surface className={cn("p-4 text-left", className)}>{body}</Surface>;
}

/** One problem from a technique's ladder: number, title, difficulty, and its
 *  contest rating when it has one. */
export function TechniqueStep({ step, className }: { step: PatternStepDto; className?: string }) {
  const { language, t } = useLanguage();
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}>
      <span className="min-w-0 flex-1 truncate text-sm text-fg">
        <span className="text-muted tabular-nums">{step.id}. </span>
        {step.title}
      </span>
      <DifficultyPill difficulty={step.difficulty} language={language} />
      {step.rating != null && (
        <span className="text-[11px] text-muted tabular-nums" title={t.patterns.ratingHint}>
          {t.patterns.rating(step.rating)}
        </span>
      )}
    </div>
  );
}

/** 灵茶山艾府's list the technique comes from, linked. */
export function TechniqueCredit({ technique, className }: { technique: PatternRefDto; className?: string }) {
  const { t } = useLanguage();
  return (
    <a
      href={technique.topic.sourceUrl}
      target="_blank"
      rel="noreferrer"
      className={cn("text-[11px] text-muted hover:text-fg hover:underline", className)}
    >
      {t.patterns.credit}
    </a>
  );
}

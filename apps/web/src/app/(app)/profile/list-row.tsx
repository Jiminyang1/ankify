"use client";

import type { PlanStatusEntryDto } from "@ankify/contracts";
import type { PlanCatalogProblem, PlanCatalogTag } from "@ankify/core/plan-catalog";
import type { Route } from "next";
import Link from "next/link";
import { memo } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { Button, buttonClasses } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Spinner } from "@/components/ui/spinner";
import { translateDifficulty } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { planProblemUrl, ratingTone, type PlanSite } from "./plan-map-model";

const DIFFICULTY_TONE = { Easy: "text-easy", Medium: "text-medium", Hard: "text-hard" } as const;
const TAG_ORDER: readonly PlanCatalogTag[] = ["nc150", "nc250", "hot100", "top150"];

/** One problem in the list view. Memoized: an open list can hold hundreds, and
 *  a tick should only redraw its own row. */
export const PlanProblemRow = memo(function PlanProblemRow({
  problem,
  entry,
  site,
  hideTag,
  videoUrl,
  adding,
  onTick,
  onAdd,
}: {
  problem: PlanCatalogProblem;
  entry: PlanStatusEntryDto | undefined;
  site: PlanSite;
  /** The block's own list, which would say nothing on its own rows. */
  hideTag?: PlanCatalogTag;
  videoUrl?: string;
  adding: boolean;
  onTick: (slug: string, done: boolean) => void;
  onAdd: (slug: string) => void;
}) {
  const { language, t } = useLanguage();
  const copy = t.planMap;
  const primary = language === "zh" ? problem.zh : problem.en || problem.zh;
  const secondary = language === "zh" && problem.en !== problem.zh ? problem.en : "";
  const done = entry != null;
  const auto = entry?.auto === true;

  return (
    <li className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 border-b border-border/60 px-1 py-1.5 last:border-b-0 hover:bg-subtle sm:grid-cols-[1rem_3.25rem_minmax(0,1fr)_auto_3.25rem_6.5rem]">
      <span className="flex items-center" title={auto ? copy.row.autoTick : undefined}>
        <input
          type="checkbox"
          checked={done}
          disabled={auto}
          aria-label={copy.row.tick(primary)}
          onChange={(event) => onTick(problem.slug, event.target.checked)}
          className="size-4 cursor-pointer accent-[rgb(var(--accent))] disabled:cursor-not-allowed"
        />
      </span>
      <span className="hidden truncate text-xs tabular-nums text-muted sm:block">{problem.label}</span>
      <a
        href={planProblemUrl(problem, site)}
        target="_blank"
        rel="noreferrer"
        className="group min-w-0 text-sm"
      >
        <span className={cn("block group-hover:text-accent group-hover:underline sm:truncate", done && "text-muted line-through decoration-border")}>
          <span className="mr-1.5 text-xs tabular-nums text-muted sm:hidden">{problem.label}</span>
          {primary}
        </span>
        {secondary && <span className="block truncate text-[11px] text-muted">{secondary}</span>}
      </a>
      <span className="col-start-2 row-start-2 flex min-w-0 flex-wrap items-center gap-1 sm:col-start-auto sm:row-start-auto sm:justify-end">
        {TAG_ORDER.filter((tag) => problem.tags.includes(tag) && tag !== hideTag).map((tag) => (
          <Pill key={tag}>{copy.tags[tag]}</Pill>
        ))}
        {problem.premium && <Pill tone="warning">{copy.tags.premium}</Pill>}
        {problem.cnOnly && <Pill tone="accent">{copy.tags.cnOnly}</Pill>}
        {videoUrl && (
          <a href={videoUrl} target="_blank" rel="noreferrer" className="inline-flex rounded-full">
            <Pill tone="accent" className="hover:border-accent/60">
              {copy.tags.video}
            </Pill>
          </a>
        )}
      </span>
      <span className="col-start-3 row-start-1 text-right text-xs tabular-nums sm:col-start-auto sm:row-start-auto">
        {problem.rating != null ? (
          <span className={ratingTone(problem.rating)}>{problem.rating}</span>
        ) : problem.difficulty ? (
          <span className={DIFFICULTY_TONE[problem.difficulty]}>{translateDifficulty(language, problem.difficulty)}</span>
        ) : null}
      </span>
      <span className="col-start-3 row-start-2 flex justify-end sm:col-start-auto sm:row-start-auto">
        <RowAction problem={problem} entry={entry} adding={adding} onAdd={onAdd} />
      </span>
    </li>
  );
});

function RowAction({
  problem,
  entry,
  adding,
  onAdd,
}: {
  problem: PlanCatalogProblem;
  entry: PlanStatusEntryDto | undefined;
  adding: boolean;
  onAdd: (slug: string) => void;
}) {
  const { t } = useLanguage();
  const copy = t.planMap.row;
  if (entry?.problemId) {
    if (entry.status === "due") {
      return (
        <Link href={`/review?problemId=${entry.problemId}` as Route} className={buttonClasses({ variant: "primary", size: "xs" })}>
          {copy.due}
        </Link>
      );
    }
    return (
      <Link href={`/problems/${entry.problemId}` as Route} className={buttonClasses({ variant: "ghost", size: "xs" })}>
        {entry.status === "remembered" ? copy.inReview : copy.archived}
      </Link>
    );
  }
  if (problem.cnOnly) return null;
  return (
    <Button variant="secondary" size="xs" disabled={adding} onClick={() => onAdd(problem.slug)}>
      {adding && <Spinner />}
      {copy.add}
    </Button>
  );
}

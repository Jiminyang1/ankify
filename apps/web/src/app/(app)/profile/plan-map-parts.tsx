"use client";

import { useId, useSyncExternalStore } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import type { PlanActionError } from "./use-plan-map";

/** Pieces the map, list, and route views share. */

export function PlanMapSkeleton() {
  return (
    <SkeletonGroup className="space-y-3">
      <Skeleton className="h-28 w-full rounded-xl" />
      {Array.from({ length: 6 }).map((_, index) => (
        <Skeleton key={index} className="h-16 w-full rounded-xl" />
      ))}
    </SkeletonGroup>
  );
}

export function PlanMapFailed({ onRetry }: { onRetry: () => void }) {
  const { t } = useLanguage();
  return (
    <Surface>
      <EmptyState
        title={t.planMap.load.failed}
        action={<Button onClick={onRetry}>{t.common.retry}</Button>}
      />
    </Surface>
  );
}

export function PlanActionAlert({ error }: { error: PlanActionError }) {
  const { load } = useLanguage().t.planMap;
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg bg-danger/10 px-4 py-2.5 text-sm text-danger">
      {error === "tick" ? load.tickFailed : error === "add" ? load.addFailed : load.planFailed}
    </p>
  );
}

/** A labelled row of pressed-or-not options: the map's and list's scope picker. */
export function PlanSegments<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { id: T; label: string }[];
  onChange: (next: T) => void;
}) {
  const labelId = useId();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span id={labelId} className="text-[11px] font-medium uppercase tracking-wide text-muted">
        {label}
      </span>
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-1 rounded-lg bg-subtle p-1">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={value === option.id}
            onClick={() => onChange(option.id)}
            className={cn(
              "h-7 rounded-md px-2.5 text-xs font-medium transition-colors",
              value === option.id ? "bg-surface text-fg shadow-card" : "text-muted hover:text-fg",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const WIDE_QUERY = "(min-width: 768px)";

function subscribeWide(notify: () => void) {
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

/** Whether the mind map is offered, at Tailwind's `md`. Null until the browser
 *  can say, so the server renders neither view. */
export function useMapIsOffered(): boolean | null {
  return useSyncExternalStore<boolean | null>(
    subscribeWide,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => null,
  );
}

/** A thin progress bar. Decorative: the numbers beside it say the same. */
export function ThinBar({ solved, total, className }: { solved: number; total: number; className?: string }) {
  const percent = total > 0 ? (solved / total) * 100 : 0;
  return (
    <div aria-hidden="true" className={cn("h-1 overflow-hidden rounded-full bg-border/70", className)}>
      <div className="h-full rounded-full bg-accent transition-[width] motion-reduce:transition-none" style={{ width: `${percent}%` }} />
    </div>
  );
}

/** "Their lists, with their permission", on any tab that shows them. */
export function LingCredit({ url, className }: { url: string; className?: string }) {
  const { t } = useLanguage();
  const copy = t.planMap.credit;
  return (
    <p className={cn("text-xs leading-5 text-muted", className)}>
      {copy.lingNote}{" "}
      <a href={url} target="_blank" rel="noreferrer" className="underline hover:text-fg">
        {copy.ling}: {copy.lingLink}
      </a>
    </p>
  );
}

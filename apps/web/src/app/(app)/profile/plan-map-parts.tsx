"use client";

import { useLanguage } from "@/components/LanguageProvider";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";

/** Pieces the list and route views share. */

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

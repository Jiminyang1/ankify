"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/components/LanguageProvider";
import { Button, buttonClasses } from "@/components/ui/button";
import { DifficultyPill } from "@/components/ui/pill";
import { Spinner } from "@/components/ui/spinner";
import { TechniqueCredit, TechniqueStep } from "@/components/technique-suggestion";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import { useHydrated } from "@/lib/use-hydrated";
import { cn, formatRelative } from "@/lib/utils";
import { weaknessCategoryName } from "@/lib/weakness-names";
import type { ChapterMistake, PlanGroup, PlanItem } from "@/server/profile";
import { StatusBar } from "./status-bar";
import { STATUS_ORDER, STATUS_SWATCH } from "./status-style";

/** A chapter's problems with one action each, plus "add every solved one to
 *  review"; once it's finished, the technique to go deeper on; and the user's
 *  weak spots on its problems. Stays open across the refresh that follows an
 *  add. */
export function GroupDialog({
  group,
  nextSlug,
  onClose,
}: {
  group: PlanGroup;
  nextSlug: string | null;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const copy = t.profile;
  const mounted = useHydrated();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [adding, setAdding] = useState<string[]>([]);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();

  useDialogA11y({ open: true, onClose, containerRef: dialogRef });

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const addable = group.items.filter((item) => item.status === "solved").map((item) => item.slug);
  const busy = adding.length > 0 || switching || refreshing;

  async function addToReview(slugs: string[]) {
    if (slugs.length === 0 || busy) return;
    setAdding(slugs);
    setError(null);
    try {
      const res = await fetch("/api/profile/add-to-review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slugs }),
      });
      const body = (await res.json().catch(() => null)) as { failed?: string[] } | null;
      if (!res.ok || (body?.failed?.length ?? 0) > 0) setError(copy.group.addFailed);
      startRefresh(() => router.refresh());
    } catch {
      setError(copy.group.addFailed);
    } finally {
      setAdding([]);
    }
  }

  async function goDeeper(plan: string) {
    if (busy) return;
    setSwitching(true);
    setError(null);
    try {
      const res = await fetch("/api/study-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) {
        setError(copy.group.switchFailed);
        return;
      }
      onClose();
      startRefresh(() => router.refresh());
    } catch {
      setError(copy.group.switchFailed);
    } finally {
      setSwitching(false);
    }
  }

  if (!mounted) return null;
  const total = group.items.length;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6" role="presentation">
      <button
        type="button"
        aria-label={copy.group.close}
        tabIndex={-1}
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative z-[101] flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl ring-1 ring-black/5 dark:ring-white/10"
      >
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id={titleId} className="text-base font-semibold">
              {group.name}
            </h2>
            <span className="text-sm tabular-nums text-muted">
              {total - group.counts.todo}/{total}
            </span>
          </div>
          <StatusBar counts={group.counts} total={total} className="mt-3 h-2" />
          <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {STATUS_ORDER.map((status) => (
              <li key={status} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className={cn("h-2.5 w-2.5 rounded-[3px]", STATUS_SWATCH[status])} />
                {copy.status[status]}
                <span className="tabular-nums text-fg">{group.counts[status]}</span>
              </li>
            ))}
          </ul>
          {addable.length > 0 && (
            <Button
              variant="primary"
              size="sm"
              className="mt-3"
              disabled={busy}
              onClick={() => void addToReview(addable)}
            >
              {busy && <Spinner />}
              {copy.group.addSolved(addable.length)}
            </Button>
          )}
          {error && (
            <p role="alert" className="mt-2 text-xs text-danger">
              {error}
            </p>
          )}
          {group.deepDive && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg bg-subtle px-3 py-2">
              <p className="min-w-0 text-xs leading-5 text-muted">
                {(group.deepDive.slug.startsWith("ling:") ? copy.group.deepDiveList : copy.group.deepDive)(
                  group.deepDive.name,
                  group.deepDive.total,
                )}
              </p>
              <Button
                variant="secondary"
                size="xs"
                disabled={busy}
                onClick={() => void goDeeper(group.deepDive!.slug)}
              >
                {switching && <Spinner />}
                {copy.group.switchPlan}
              </Button>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {group.deeper && <GoDeeper deeper={group.deeper} />}
          {group.mistakes.length > 0 && <ChapterMistakes mistakes={group.mistakes} />}
          <ul className="divide-y divide-border">
            {group.items.map((item) => (
              <PlanItemRow
                key={item.slug}
                item={item}
                isNext={item.slug === nextSlug}
                adding={adding.includes(item.slug)}
                busy={busy}
                onAdd={() => void addToReview([item.slug])}
              />
            ))}
          </ul>
        </div>

        <div className="flex justify-end border-t border-border px-5 py-3">
          <Button onClick={onClose}>{copy.group.close}</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PlanItemRow({
  item,
  isNext,
  adding,
  busy,
  onAdd,
}: {
  item: PlanItem;
  isNext: boolean;
  adding: boolean;
  busy: boolean;
  onAdd: () => void;
}) {
  const { language, t } = useLanguage();
  const copy = t.profile.group;
  const ghost = buttonClasses({ variant: "ghost", size: "xs" });
  const primary = buttonClasses({ variant: "primary", size: "xs" });

  let note: string;
  let noteTone = "text-muted";
  let action: React.ReactNode;
  if (item.status === "due") {
    note = copy.item.due;
    noteTone = "font-medium text-warning";
    action = (
      <Link href={`/review?problemId=${item.problemId}` as Route} className={primary}>
        {copy.actions.review}
      </Link>
    );
  } else if (item.status === "remembered") {
    note = copy.item.remembered(formatRelative(item.due));
    action = (
      <Link href={`/problems/${item.problemId}` as Route} className={ghost}>
        {copy.actions.open}
      </Link>
    );
  } else if (item.status === "solved") {
    note = item.archived ? copy.item.archived : copy.item.solved;
    action = (
      <Button variant="secondary" size="xs" disabled={busy} onClick={onAdd}>
        {adding && <Spinner />}
        {copy.actions.add}
      </Button>
    );
  } else {
    note = isNext ? copy.item.next : copy.item.todo;
    if (isNext) noteTone = "font-medium text-accent";
    action = (
      <a
        href={`https://leetcode.com/problems/${item.slug}/`}
        target="_blank"
        rel="noreferrer"
        className={isNext ? primary : ghost}
      >
        {copy.actions.leetcode}
      </a>
    );
  }

  return (
    <li className="grid grid-cols-[0.625rem_minmax(0,1fr)_auto] items-center gap-3 px-5 py-2.5 sm:grid-cols-[0.625rem_minmax(0,1fr)_9.5rem_auto]">
      <span aria-hidden="true" className={cn("h-2.5 w-2.5 rounded-[3px]", STATUS_SWATCH[item.status])} />
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-xs tabular-nums text-muted">{item.leetcodeId}.</span>
          <span className="truncate text-sm">{item.title}</span>
          <span className="hidden shrink-0 sm:inline-flex">
            <DifficultyPill difficulty={item.difficulty} language={language} />
          </span>
        </span>
        <span className={cn("mt-0.5 block text-xs sm:hidden", noteTone)}>{note}</span>
      </span>
      <span className={cn("hidden text-xs sm:block", noteTone)}>{note}</span>
      {action}
    </li>
  );
}

/** A finished chapter: the next problems on the ladder of the technique most
 *  of its problems use. */
function GoDeeper({ deeper }: { deeper: NonNullable<PlanGroup["deeper"]> }) {
  const { language, t } = useLanguage();
  const copy = t.profile.group;
  return (
    <section className="border-b border-border bg-accent-soft/30 px-5 py-4">
      <h3 className="text-sm font-semibold">{copy.deeperTitle(deeper.technique.name[language])}</h3>
      <p className="mt-1 text-xs leading-5 text-muted">{copy.deeperBody}</p>
      <ul className="mt-3 space-y-2">
        {deeper.problems.map((problem) => (
          <li key={problem.slug} className="flex items-center gap-3">
            <TechniqueStep step={problem} className="min-w-0 flex-1" />
            <a
              href={`https://leetcode.com/problems/${problem.slug}/`}
              target="_blank"
              rel="noreferrer"
              className={buttonClasses({ variant: "secondary", size: "xs" })}
            >
              {copy.actions.leetcode}
            </a>
          </li>
        ))}
      </ul>
      <TechniqueCredit technique={deeper.technique} className="mt-3 inline-block" />
    </section>
  );
}

/** The user's active weak spots on this chapter's problems. */
function ChapterMistakes({ mistakes }: { mistakes: ChapterMistake[] }) {
  const { language, t } = useLanguage();
  const copy = t.profile.group;
  return (
    <section className="border-b border-border px-5 py-4">
      <h3 className="text-sm font-semibold">{copy.mistakesTitle}</h3>
      <ul className="mt-2 space-y-2">
        {mistakes.map((mistake) => (
          <li key={mistake.id} className="text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-medium text-fg">
                {weaknessCategoryName(mistake.category, mistake.categoryName, language)}
              </span>
              <Link
                href={`/problems/${mistake.problem.id}` as Route}
                className="min-w-0 truncate text-xs text-muted hover:text-accent hover:underline"
              >
                {mistake.problem.title}
              </Link>
              <span className="text-xs text-muted tabular-nums">{copy.timesSeen(mistake.hitCount)}</span>
            </div>
            <p className="mt-0.5 text-xs leading-5 text-muted">{mistake.detail}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

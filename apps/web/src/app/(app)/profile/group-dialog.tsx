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
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import { useHydrated } from "@/lib/use-hydrated";
import { cn, formatRelative } from "@/lib/utils";
import type { PlanGroup, PlanItem } from "@/server/profile";
import { StatusBar } from "./status-bar";
import { STATUS_ORDER, STATUS_SWATCH } from "./status-style";

/** A pattern's problems with one action each, plus "add every solved one to
 *  review". Stays open across the refresh that follows an add. */
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
  const busy = adding.length > 0 || refreshing;

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
        </div>

        <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
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

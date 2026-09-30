"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { buttonClasses } from "@/components/ui/button";
import { DifficultyPill } from "@/components/ui/pill";
import { Surface } from "@/components/ui/surface";
import { cn, formatRelative } from "@/lib/utils";
import type { PlanGroup, PlanItem } from "@/server/profile";
import { STATUS_SQUARE } from "./status-style";

/** One row per plan group, one square per problem. Rows start collapsed so
 *  the whole plan reads at a glance; a row expands into its problem list. */
export function PlanMap({
  groups,
  currentIndex,
  nextSlug,
}: {
  groups: PlanGroup[];
  currentIndex: number;
  nextSlug: string | null;
}) {
  const { t } = useLanguage();
  const copy = t.profile;
  const [open, setOpen] = useState<number | null>(null);

  return (
    <Surface className="divide-y divide-border overflow-hidden">
      {groups.map((group, index) => {
        const isOpen = open === index;
        const isCurrent = index === currentIndex;
        return (
          <div key={group.name} className={cn(isCurrent && "bg-accent-soft/25")}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : index)}
              aria-expanded={isOpen}
              className="grid w-full grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-subtle/60 sm:grid-cols-[1.5rem_13rem_minmax(0,1fr)_3.5rem]"
            >
              <span className="text-xs tabular-nums text-muted">{index + 1}</span>
              <span className="flex min-w-0 items-center gap-2">
                <span className={cn("truncate text-sm font-medium", isCurrent && "text-accent")}>{group.name}</span>
                {isCurrent && (
                  <span
                    title={copy.currentInfo}
                    className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent"
                  >
                    {copy.current}
                  </span>
                )}
              </span>
              <span className="text-right text-xs tabular-nums text-muted sm:order-last">
                {group.done}/{group.items.length}
              </span>
              <span aria-hidden="true" className="col-span-3 col-start-1 flex flex-wrap gap-1 sm:col-span-1 sm:col-start-auto">
                {group.items.map((item) => (
                  <span
                    key={item.slug}
                    title={
                      item.slug === nextSlug
                        ? copy.nextSquare(item.title)
                        : `${item.title} · ${copy.status[item.status]}`
                    }
                    className={cn(
                      "h-3.5 w-3.5 rounded-[3px]",
                      STATUS_SQUARE[item.status],
                      item.slug === nextSlug && "ring-2 ring-accent ring-offset-1 ring-offset-surface",
                    )}
                  />
                ))}
              </span>
            </button>
            {isOpen && (
              <ul className="divide-y divide-border border-t border-border bg-bg/40">
                {group.items.map((item) => (
                  <PlanItemRow key={item.slug} item={item} isNext={item.slug === nextSlug} />
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </Surface>
  );
}

function PlanItemRow({ item, isNext }: { item: PlanItem; isNext: boolean }) {
  const { language, t } = useLanguage();
  const copy = t.profile;
  const leetcodeUrl = `https://leetcode.com/problems/${item.slug}/`;

  let note: string;
  let noteTone = "text-muted";
  let action: { label: string; href: string; external?: boolean; primary?: boolean };

  if (item.problemId && !item.archived) {
    const review = { label: copy.actions.review, href: `/review?problemId=${item.problemId}` };
    const open = { label: copy.actions.open, href: `/problems/${item.problemId}` };
    if (item.status === "fading") {
      note = copy.item.recall(Math.round((item.recall ?? 0) * 100));
      noteTone = "text-warning";
      action = { ...review, primary: true };
    } else if (item.recall == null) {
      note = copy.item.notReviewed;
      action = item.dueNow ? review : open;
    } else {
      note = copy.item.due(formatRelative(item.due));
      action = item.dueNow ? review : open;
    }
  } else if (item.problemId) {
    note = copy.item.archived;
    action = { label: copy.actions.open, href: `/problems/${item.problemId}` };
  } else if (item.status === "solved") {
    note = copy.item.solvedOnLeetcode;
    action = { label: copy.actions.leetcode, href: leetcodeUrl, external: true };
  } else {
    note = isNext ? copy.item.next : copy.item.notStarted;
    if (isNext) noteTone = "font-medium text-accent";
    action = { label: copy.actions.leetcode, href: leetcodeUrl, external: true, primary: isNext };
  }

  const actionClass = buttonClasses({ variant: action.primary ? "primary" : "ghost", size: "xs" });

  return (
    <li className="grid grid-cols-[0.875rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 sm:grid-cols-[0.875rem_minmax(0,1fr)_11rem_auto] sm:pl-[3.25rem]">
      <span aria-hidden="true" className={cn("h-3.5 w-3.5 rounded-[3px]", STATUS_SQUARE[item.status])} />
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
      {action.external ? (
        <a href={action.href} target="_blank" rel="noreferrer" className={actionClass}>
          {action.label}
        </a>
      ) : (
        <Link href={action.href as Route} className={actionClass}>
          {action.label}
        </Link>
      )}
    </li>
  );
}

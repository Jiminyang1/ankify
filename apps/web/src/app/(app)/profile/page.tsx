import Link from "next/link";
import type { Route } from "next";
import { buttonClasses } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { PageFrame, PageHeader } from "@/components/ui/page";
import { DifficultyPill } from "@/components/ui/pill";
import { Surface } from "@/components/ui/surface";
import { cn, formatRelative } from "@/lib/utils";
import { requirePageUser } from "@/server/auth";
import { getRequestLanguage, getRequestTranslations } from "@/server/i18n";
import { loadProfile } from "@/server/profile";
import { LeetcodeCard } from "./leetcode-card";
import { PlanMap } from "./plan-map";
import { PlanSwitcher } from "./plan-switcher";
import { STATUS_BAR, STATUS_ORDER, STATUS_SQUARE } from "./status-style";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await requirePageUser();
  const [t, language, data] = await Promise.all([
    getRequestTranslations(),
    getRequestLanguage(),
    loadProfile(user.id),
  ]);
  const copy = t.profile;
  const current = data.currentIndex >= 0 ? data.groups[data.currentIndex]! : null;
  const solved = data.total - data.counts.todo;
  const fadingHref = data.fading[0]?.problemId ? (`/review?problemId=${data.fading[0].problemId}` as Route) : null;

  return (
    <PageFrame width="wide" className="space-y-6">
      <PageHeader
        title={copy.title}
        description={copy.subtitle(data.plan.name)}
        actions={<PlanSwitcher plans={data.plans} current={data.plan.slug} />}
      />

      <Surface className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-semibold tabular-nums">{solved}</span>
            <span className="text-sm text-muted">{copy.solvedOf(data.total)}</span>
          </div>
          <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-border/70">
            {STATUS_ORDER.filter((status) => status !== "todo" && data.counts[status] > 0).map((status) => (
              <div
                key={status}
                className={STATUS_BAR[status]}
                style={{ width: `${(data.counts[status] / data.total) * 100}%` }}
              />
            ))}
          </div>
          <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
            {STATUS_ORDER.map((status) => (
              <li key={status} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className={cn("h-2.5 w-2.5 rounded-[3px]", STATUS_SQUARE[status])} />
                {copy.status[status]}
                <span className="tabular-nums text-fg">{data.counts[status]}</span>
              </li>
            ))}
            <li className="inline-flex">
              <InfoTip label={copy.statusInfo} align="right" />
            </li>
          </ul>
          {!data.leetcode && <p className="mt-4 text-xs text-muted">{copy.connectHint}</p>}
        </div>

        <div className="border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{copy.upNext}</div>
          {current && data.next ? (
            <>
              <div className="mt-1 text-xs text-muted">
                {copy.stage(data.currentIndex + 1, data.groups.length)} · {current.name} · {current.done}/
                {current.items.length}
              </div>
              <div className="mt-3 font-medium leading-snug">
                <span className="tabular-nums text-muted">{data.next.leetcodeId}.</span> {data.next.title}
              </div>
              <div className="mt-1.5">
                <DifficultyPill difficulty={data.next.difficulty} language={language} />
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">{copy.planComplete}</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {data.next && (
              <a
                href={`https://leetcode.com/problems/${data.next.slug}/`}
                target="_blank"
                rel="noreferrer"
                className={buttonClasses({ variant: "primary", size: "sm" })}
              >
                {copy.openOnLeetcode}
              </a>
            )}
            {fadingHref && (
              <Link href={fadingHref} className={buttonClasses({ variant: "secondary", size: "sm" })}>
                {copy.reviewFading(data.fading.length)}
              </Link>
            )}
          </div>
        </div>
      </Surface>

      <PlanMap groups={data.groups} currentIndex={data.currentIndex} nextSlug={data.next?.slug ?? null} />

      <section id="leetcode" className="space-y-2">
        <LeetcodeCard account={data.leetcode} stale={data.leetcodeStale} />
        {data.leetcode && (
          <p className="text-xs text-muted">
            {data.solvedSync
              ? copy.solvedSynced(data.solvedSync.count, formatRelative(data.solvedSync.syncedAt))
              : copy.leetcodeNote}
          </p>
        )}
      </section>
    </PageFrame>
  );
}

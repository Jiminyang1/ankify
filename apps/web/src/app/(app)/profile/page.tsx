import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { PageFrame, PageHeader } from "@/components/ui/page";
import { DifficultyPill } from "@/components/ui/pill";
import { Surface } from "@/components/ui/surface";
import { cn, formatRelative } from "@/lib/utils";
import { requirePageUser } from "@/server/auth";
import { getRequestLanguage, getRequestTranslations } from "@/server/i18n";
import { loadProfile } from "@/server/profile";
import { ProfileGuide } from "./guide";
import { LeetcodeCard } from "./leetcode-card";
import { PlanPicker } from "./plan-picker";
import { Roadmap } from "./roadmap";
import { StatusBar } from "./status-bar";
import { STATUS_ORDER, STATUS_SWATCH } from "./status-style";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await requirePageUser();
  const [t, language, data] = await Promise.all([
    getRequestTranslations(),
    getRequestLanguage(),
    loadProfile(user.id),
  ]);
  const copy = t.profile;
  const solved = data.total - data.counts.todo;

  return (
    <PageFrame width="wide" className="space-y-6">
      <PageHeader
        title={copy.title}
        description={copy.subtitle(data.plan.name)}
        actions={<PlanPicker plans={data.plans} current={data.plan} />}
      />

      <Surface className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-semibold tabular-nums">{solved}</span>
            <span className="text-sm text-muted">{copy.solvedOf(data.total)}</span>
          </div>
          <StatusBar counts={data.counts} total={data.total} className="mt-4 h-2.5" />
          <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
            {STATUS_ORDER.map((status) => (
              <li key={status} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className={cn("h-2.5 w-2.5 rounded-[3px]", STATUS_SWATCH[status])} />
                {copy.status[status]}
                <span className="tabular-nums text-fg">{data.counts[status]}</span>
              </li>
            ))}
          </ul>
          {!data.solvedSync && <p className="mt-4 text-xs text-muted">{copy.connectHint}</p>}
        </div>

        <div className="flex flex-col gap-4 border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          {data.counts.due > 0 && (
            <Link href="/review" className={buttonClasses({ variant: "primary", size: "md", className: "w-full" })}>
              {copy.reviewDue(data.counts.due)}
            </Link>
          )}
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{copy.nextProblem}</div>
            {data.next ? (
              <div className="mt-1.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    <span className="tabular-nums text-muted">{data.next.leetcodeId}.</span> {data.next.title}
                  </div>
                  <div className="mt-1">
                    <DifficultyPill difficulty={data.next.difficulty} language={language} />
                  </div>
                </div>
                <a
                  href={`https://leetcode.com/problems/${data.next.slug}/`}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonClasses({ variant: data.counts.due > 0 ? "secondary" : "primary", size: "sm" })}
                >
                  {copy.openOnLeetcode}
                </a>
              </div>
            ) : (
              <p className="mt-1.5 text-sm text-muted">{copy.planComplete}</p>
            )}
          </div>
        </div>
      </Surface>

      <ProfileGuide solvedSynced={data.solvedSync != null} />

      <Roadmap planSlug={data.plan.slug} groups={data.groups} nextSlug={data.next?.slug ?? null} />

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

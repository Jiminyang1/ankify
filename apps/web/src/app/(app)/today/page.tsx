import Link from "next/link";
import type { Route } from "next";
import { Surface } from "@/components/ui/surface";
import { DifficultyPill, Pill } from "@/components/ui/pill";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requirePageUser } from "@/server/auth";
import { getRequestLanguage, getRequestTranslations } from "@/server/i18n";
import { formatRelative } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { getUserFirstName } from "@/lib/user-identity";
import { getExtensionInstallUrl } from "@/lib/extension-install";
import { PageFrame } from "@/components/ui/page";
import { getAiSettings } from "@/server/settings";
import { getStarterAiStatus } from "@/server/starter-ai";
import { getOnboardingProgress } from "@/server/onboarding";
import { loadDashboard, type DashboardSession } from "@/server/dashboard";
import { OnboardingCard } from "./onboarding-card";

export const dynamic = "force-dynamic";

/** The dashboard: the popup's daily view plus recent practice and focus areas. */
export default async function HomePage() {
  const user = await requirePageUser();
  const [t, language] = await Promise.all([getRequestTranslations(), getRequestLanguage()]);
  const [dashboard, onboarding, ai, starter] = await Promise.all([
    loadDashboard(user.id),
    getOnboardingProgress(user.id),
    getAiSettings(user.id),
    getStarterAiStatus(user.id),
  ]);
  const d = t.dashboard;
  const { overview, profile, recent, week } = dashboard;
  const { counts } = overview;
  const next = overview.due[0];
  const firstName = getUserFirstName(user.name, user.email);
  const welcomeMessage = counts.dueNow > 0 ? t.home.welcomeDue : recent.length > 0 ? t.home.welcomeDone : t.home.welcomeEmpty;
  const category = (id: string) => t.mistakes.categories[id as keyof typeof t.mistakes.categories] ?? id;

  return (
    <PageFrame width="standard" className="space-y-8">
      <div className="flex items-center gap-3">
        <UserAvatar name={user.name} email={user.email} image={user.image} size="md" />
        <div>
          <p className="font-semibold">{t.home.welcomeBack(firstName)}</p>
          <p className="mt-0.5 text-sm text-muted">{welcomeMessage}</p>
        </div>
      </div>

      {!onboarding.complete && (
        <OnboardingCard
          initialProgress={onboarding}
          initialAi={{ provider: ai.provider, model: ai.model, hasApiKey: Boolean(ai.encryptedApiKey) }}
          starter={{ enabled: starter.enabled, remaining: starter.remaining, limit: starter.limit }}
          installUrl={getExtensionInstallUrl()}
          language={language}
        />
      )}

      <Surface className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">{t.home.kicker}</p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight">
              {counts.dueNow > 0 ? (
                <>
                  <span className="text-accent">{counts.dueNow}</span> {t.home.dueHeroSuffix(counts.dueNow)}
                </>
              ) : (
                d.caughtUp
              )}
            </h1>
            <p className="mt-2 max-w-xl text-sm text-muted">{d.reviewOnLeetcode}</p>
          </div>
          {next ? (
            <a href={next.url} target="_blank" rel="noreferrer" className={buttonClasses({ variant: "primary", size: "lg" })}>
              {d.openNextReview}
            </a>
          ) : (
            <Link href="/suggestions" className={buttonClasses({ variant: "primary", size: "lg" })}>
              {d.openSuggestions}
            </Link>
          )}
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-4">
          <MiniStat label={d.reviewsToday} value={counts.reviewsToday} />
          <MiniStat label={d.firstPractices} value={counts.initialLearningToday} />
          <MiniStat label={d.overdue} value={counts.overdue} accent={counts.overdue > 0} />
          <MiniStat label={d.upcomingWeek} value={counts.upcomingWeek} />
        </div>
      </Surface>

      {(overview.pendingRatings.length > 0 || overview.openSessions.length > 0) && (
        <Surface role="status" className="space-y-1 p-4 text-sm">
          {overview.pendingRatings.length > 0 && <p>{d.pendingRatings(overview.pendingRatings.length)}</p>}
          {overview.openSessions.length > 0 && <p>{d.openSessions(overview.openSessions.length)}</p>}
        </Surface>
      )}

      {overview.due.length > 0 && (
        <section aria-label={d.dueTitle} className="space-y-3">
          <h2 className="text-lg font-semibold">{d.dueTitle}</h2>
          <Surface as="ul" className="divide-y divide-border overflow-hidden">
            {overview.due.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Link href={`/problems/${item.id}` as Route} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">
                  {item.title}
                </Link>
                <DifficultyPill difficulty={item.difficulty} language={language} />
                <span className="text-xs text-muted">{item.overdueDays > 0 ? d.overdueDays(item.overdueDays) : d.dueToday}</span>
                <a href={item.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-accent hover:underline">
                  LeetCode
                </a>
              </li>
            ))}
          </Surface>
        </section>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Surface as="section" aria-label={d.recent} className="space-y-3 p-5">
          <div>
            <h2 className="text-base font-semibold">{d.recent}</h2>
            <p className="mt-1 text-sm text-muted">
              {d.week}: {d.weekStats(week.completed, week.accepted, week.failed)}
            </p>
          </div>
          {recent.length === 0 ? (
            <EmptyState title={d.noRecent} description={d.noRecentHelp} />
          ) : (
            <ul className="space-y-2 text-sm">
              {recent.map((session) => (
                <RecentRow key={session.id} session={session} kind={d.kinds[session.type] ?? session.type} state={stateLabel(d.states, session)} />
              ))}
            </ul>
          )}
        </Surface>

        <Surface as="section" aria-label={d.focus} className="space-y-3 p-5">
          <h2 className="text-base font-semibold">{d.focus}</h2>
          {!profile.personalized ? (
            <p className="text-sm text-muted">{d.focusNotReady}</p>
          ) : profile.focus.length === 0 ? (
            <p className="text-sm text-muted">{d.focusNone}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {profile.focus.map((item) => (
                <li key={item.category}>{d.focusItem(category(item.category), item.contexts, item.problems)}</li>
              ))}
            </ul>
          )}
          <Link href="/analysis" className="inline-block text-sm font-medium text-accent hover:underline">
            {d.viewProfile}
          </Link>
          <div className="border-t border-border pt-3 text-sm">
            <p className="text-muted">{dashboard.pendingSuggestions > 0 ? d.suggestionsPending(dashboard.pendingSuggestions) : d.noSuggestions}</p>
            <Link href="/suggestions" className="mt-1 inline-block font-medium text-accent hover:underline">
              {d.openSuggestions}
            </Link>
          </div>
        </Surface>
      </div>
    </PageFrame>
  );
}

function stateLabel(states: Record<string, string>, session: DashboardSession) {
  return states[session.status === "completed" ? (session.outcome ?? "unknown") : session.status] ?? session.status;
}

function RecentRow({ session, kind, state }: { session: DashboardSession; kind: string; state: string }) {
  const tone = session.outcome === "accepted" ? "success" : session.outcome === "failed" ? "danger" : "neutral";
  return (
    <li className="flex flex-wrap items-center gap-2">
      <Link href={`/problems/${session.problemId}` as Route} className="min-w-0 flex-1 truncate hover:underline">
        {session.title}
      </Link>
      <span className="text-xs text-muted">{kind}</span>
      <Pill tone={tone}>{state}</Pill>
      <span className="text-xs tabular-nums text-muted">{formatRelative(session.at)}</span>
    </li>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-subtle px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={"mt-1 text-2xl font-semibold tabular-nums " + (accent ? "text-accent" : "")}>{value}</div>
    </div>
  );
}

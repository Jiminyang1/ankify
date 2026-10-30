import Link from "next/link";
import { leetcodeTagName } from "@ankify/core";
import type { PlanNextDto } from "@ankify/contracts";
import { Surface } from "@/components/ui/surface";
import { DifficultyPill, FsrsStatePill } from "@/components/ui/pill";
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
import type { Translation } from "@/lib/i18n";
import { loadPlanNext, loadSolvedSummary } from "@/server/profile";
import { getOnboardingProgress } from "@/server/onboarding";
import { getCurrentStudyPlan } from "@/server/study-plans";
import { OnboardingCard } from "./onboarding-card";
import { loadToday } from "@/server/today";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requirePageUser();
  const [t, language] = await Promise.all([getRequestTranslations(), getRequestLanguage()]);

  const [data, onboarding, ai, starter, solvedSummary, planNext] = await Promise.all([
    loadToday(user.id),
    getOnboardingProgress(user.id),
    getAiSettings(user.id),
    getStarterAiStatus(user.id),
    loadSolvedSummary(user.id, language),
    loadPlanNext(user.id, language),
  ]);
  // Onboarding's plan step offers the Plan page's plans, the current one preselected.
  const planChoice = onboarding.complete ? null : await getCurrentStudyPlan(user.id, language);
  const hasDue = data.dueCount > 0;
  const allDone = data.totalProblems > 0 && !hasDue;
  const held = Math.max(0, data.totalDue - data.dueCount);
  const firstName = getUserFirstName(user.name, user.email);
  const welcomeMessage = hasDue
    ? t.home.welcomeDue
    : allDone
      ? t.home.welcomeDone
      : t.home.welcomeEmpty;

  return (
    <PageFrame width="standard" className="space-y-8">
      <div className="flex items-center gap-3">
        <UserAvatar
          name={user.name}
          email={user.email}
          image={user.image}
          size="md"
        />
        <div>
          <p className="font-semibold">{t.home.welcomeBack(firstName)}</p>
          <p className="mt-0.5 text-sm text-muted">{welcomeMessage}</p>
        </div>
      </div>

      {!onboarding.complete && planChoice && (
        <OnboardingCard
          initialProgress={onboarding}
          initialAi={{
            provider: ai.provider,
            model: ai.model,
            hasApiKey: Boolean(ai.encryptedApiKey),
          }}
          starter={{ enabled: starter.enabled, remaining: starter.remaining, limit: starter.limit }}
          installUrl={getExtensionInstallUrl()}
          language={language}
          solvedSummary={solvedSummary}
          plans={planChoice.options}
          currentPlan={planChoice.plan.slug}
        />
      )}

        <Surface className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">{t.home.kicker}</p>
              <h1 className="mt-2 text-4xl font-semibold tracking-tight">
                {hasDue ? (
                  <>
                    <span className="text-accent">{data.dueCount}</span> {t.home.dueHeroSuffix(data.dueCount)}
                  </>
                ) : allDone ? (
                  t.home.doneForToday
                ) : (
                  t.home.noProblemsYet
                )}
              </h1>
            </div>
            <Link
              href={hasDue ? "/review" : "/problems"}
              className={buttonClasses({ variant: "primary", size: "lg" })}
            >
              {hasDue ? t.home.startSession : t.home.openDeck}
            </Link>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <MiniStat label={t.home.doneToday} value={data.doneToday} suffix={`/${data.dailyReviewLimit}`} />
            <MiniStat label={t.home.dueNow} value={data.dueCount} accent={hasDue} />
            <MiniStat label={t.home.deck} value={data.totalProblems} />
          </div>
        </Surface>

      {"error" in data && data.error && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {t.common.databaseNotInitialized}
        </div>
      )}

      {data.dueProblems.length > 0 ? (
        <section>
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">{t.home.queueTitle}</h2>
              <p className="mt-1 text-sm text-muted">
                {t.home.queueDescription(held)}
              </p>
            </div>
            <Link href="/review" className="text-sm font-medium text-accent hover:underline">
              {t.home.reviewNow}
            </Link>
          </div>

          <ul className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-card">
            {data.dueProblems.map((problem, index) => (
              <li key={problem.id}>
                <Link href={`/problems/${problem.id}`} className="grid gap-3 px-4 py-3 transition hover:bg-subtle sm:grid-cols-[32px_1fr_auto] sm:items-center">
                  <div className="text-xs text-muted tabular-nums">{String(index + 1).padStart(2, "0")}</div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{problem.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <DifficultyPill difficulty={problem.difficulty} language={language} />
                      <FsrsStatePill state={problem.fsrsState} language={language} />
                      {problem.topicTags.slice(0, 3).map((tag) => (
                        <span key={tag} className="text-xs text-muted">
                          #{leetcodeTagName(tag)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-xs text-muted sm:text-right">{formatRelative(problem.fsrsDue)}</div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        !("error" in data && data.error) && (
          <Surface className="p-4">
            <EmptyState
              title={allDone ? t.home.noReviewsDue : t.home.captureToStart}
              description={allDone ? t.home.nextSession : t.home.captureHint}
              action={
                allDone ? undefined : (
                  <a
                    href={getExtensionInstallUrl()}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonClasses({ variant: "primary", size: "sm" })}
                  >
                    {t.home.getExtension}
                  </a>
                )
              }
            />
          </Surface>
        )
      )}

      <PlanNextSection data={planNext} t={t} language={language} hasDue={hasDue} />
    </PageFrame>
  );
}

/** Today's second part, after the reviews (which stay the point of Today):
 *  the plan's next unsolved problem and the chapter it's in. */
function PlanNextSection({
  data,
  t,
  language,
  hasDue,
}: {
  data: PlanNextDto;
  t: Translation;
  language: "en" | "zh";
  hasDue: boolean;
}) {
  const copy = t.planNext;
  const { plan, next } = data;
  return (
    <section>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{copy.title}</h2>
          <p className="mt-1 truncate text-sm text-muted">{copy.summary(plan.name, plan.done, plan.total)}</p>
        </div>
        <Link href="/profile" className="shrink-0 text-sm font-medium text-accent hover:underline">
          {copy.roadmap}
        </Link>
      </div>

      {next ? (
        <Surface className="mt-4 divide-y divide-border overflow-hidden">
          <div className="px-4 py-3">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{copy.chapter}</p>
                <p className="mt-1 truncate text-sm font-medium">{next.chapter.name}</p>
              </div>
              <span className="shrink-0 text-xs text-muted tabular-nums">
                {copy.chapterProgress(next.chapter.done, next.chapter.total)}
              </span>
            </div>
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-border/70">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${(next.chapter.done / Math.max(1, next.chapter.total)) * 100}%` }}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                <span className="tabular-nums text-muted">{next.problem.leetcodeId}. </span>
                {next.problem.title}
              </p>
              <div className="mt-1">
                <DifficultyPill difficulty={next.problem.difficulty} language={language} />
              </div>
            </div>
            <a
              href={`https://leetcode.com/problems/${next.problem.slug}/`}
              target="_blank"
              rel="noreferrer"
              className={buttonClasses({ variant: hasDue ? "secondary" : "primary", size: "sm" })}
            >
              {copy.open}
            </a>
          </div>
        </Surface>
      ) : (
        <Surface className="mt-4 p-4">
          <EmptyState
            title={copy.complete(plan.name, plan.total)}
            description={copy.completeHint}
            action={
              <Link href="/profile" className={buttonClasses({ variant: "primary", size: "sm" })}>
                {copy.pickPlan}
              </Link>
            }
          />
        </Surface>
      )}

      {plan.sourceUrl && (
        <p className="mt-2 text-xs text-muted">
          {t.profile.sourceCredit}{" "}
          <a href={plan.sourceUrl} target="_blank" rel="noreferrer" className="underline hover:text-fg">
            {t.profile.sourceLink}
          </a>
        </p>
      )}
    </section>
  );
}

function MiniStat({
  label,
  value,
  suffix,
  accent,
}: {
  label: string;
  value: number;
  suffix?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-subtle px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={"mt-1 text-2xl font-semibold tabular-nums " + (accent ? "text-accent" : "")}>
        {value}
        {suffix && <span className="text-sm text-muted">{suffix}</span>}
      </div>
    </div>
  );
}

import Link from "next/link";
import { getDb, schema } from "@ankify/db";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Surface } from "@/components/ui/surface";
import { DifficultyPill, FsrsStatePill, Pill } from "@/components/ui/pill";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requirePageUser } from "@/lib/auth";
import { dueProblemCondition } from "@/lib/due-problems";
import { getRequestLanguage, getRequestTranslations } from "@/lib/i18n-server";
import { getReviewQueueStatus } from "@/lib/review-queue";
import { formatRelative } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { getUserFirstName } from "@/lib/user-identity";
import { getExtensionInstallUrl } from "@/lib/extension-install";
import { PageFrame } from "@/components/ui/page";
import { getAiSettings } from "@/lib/settings";
import { getOnboardingProgress } from "@/lib/onboarding";
import { OnboardingCard } from "./onboarding-card";

export const dynamic = "force-dynamic";

async function getHomeData(userId: string) {
  try {
    const db = getDb();
    const now = new Date();

    const [queue, totalRows, allDueProblems] = await Promise.all([
      getReviewQueueStatus(userId),
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.problems)
        .where(and(eq(schema.problems.userId, userId), isNull(schema.problems.archivedAt))),
      db
        .select()
        .from(schema.problems)
        .where(dueProblemCondition(userId, now))
        .orderBy(asc(sql`COALESCE(${schema.problems.fsrsDue}, 0)`), desc(schema.problems.createdAt))
        .limit(8),
    ]);
    const totalRow = totalRows[0];
    const dueProblems = allDueProblems.slice(0, Math.min(8, queue.remaining));

    const dueProblemIds = dueProblems.map((problem) => problem.id);
    const cardStats = dueProblemIds.length
      ? await db
          .select({
            problemId: schema.cards.problemId,
            total: sql<number>`count(*)`,
          })
          .from(schema.cards)
          .where(
            and(
              eq(schema.cards.userId, userId),
              eq(schema.cards.aiStatus, "ready"),
              inArray(schema.cards.problemId, dueProblemIds),
            ),
          )
          .groupBy(schema.cards.problemId)
      : [];

    return {
      totalProblems: totalRow?.count ?? 0,
      dueCount: queue.dueCount,
      totalDue: queue.totalDue,
      doneToday: queue.doneToday,
      dailyReviewLimit: queue.dailyReviewLimit,
      dueProblems,
      cardsByProblem: new Map(cardStats.map((m) => [m.problemId, m.total ?? 0])),
    };
  } catch {
    return {
      totalProblems: 0,
      dueCount: 0,
      totalDue: 0,
      doneToday: 0,
      dailyReviewLimit: 20,
      dueProblems: [],
      cardsByProblem: new Map<string, number>(),
      error: true,
    } as const;
  }
}

export default async function HomePage() {
  const user = await requirePageUser();
  const [t, language] = await Promise.all([getRequestTranslations(), getRequestLanguage()]);

  const [data, onboarding, ai] = await Promise.all([
    getHomeData(user.id),
    getOnboardingProgress(user.id),
    getAiSettings(user.id),
  ]);
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

      {!onboarding.complete && (
        <OnboardingCard
          initialProgress={onboarding}
          initialAi={{
            provider: ai.provider,
            model: ai.model,
            hasApiKey: Boolean(ai.encryptedApiKey),
          }}
          installUrl={getExtensionInstallUrl()}
          language={language}
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
            {data.dueProblems.map((problem, index) => {
              const cardCount = data.cardsByProblem.get(problem.id) ?? 0;
              return (
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
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs sm:justify-end">
                      <Pill tone={cardCount > 0 ? "accent" : "neutral"}>
                        {cardCount > 0 ? t.common.cards(cardCount) : t.home.needsCards}
                      </Pill>
                      <span className="text-muted">{formatRelative(problem.fsrsDue)}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
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
    </PageFrame>
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

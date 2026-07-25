import Link from "next/link";
import { getDb, schema } from "@ankify/db";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Surface } from "@/components/ui/surface";
import { DifficultyPill, FsrsStatePill, Pill } from "@/components/ui/pill";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { getOptionalPageUser } from "@/lib/auth";
import { dueProblemCondition } from "@/lib/due-problems";
import { getRequestLanguage, getRequestTranslations } from "@/lib/i18n-server";
import { getReviewQueueStatus } from "@/lib/review-queue";
import { formatRelative } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function getHomeData(userId: string) {
  try {
    const db = getDb();
    const now = new Date();

    const [queue, totalRows, allDueProblems] = await Promise.all([
      getReviewQueueStatus(userId, db),
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
  const user = await getOptionalPageUser();
  const [t, language] = await Promise.all([getRequestTranslations(), getRequestLanguage()]);
  if (!user) return <PublicLanding language={language} />;

  const data = await getHomeData(user.id);
  const hasDue = data.dueCount > 0;
  const allDone = data.totalProblems > 0 && !hasDue;
  const held = Math.max(0, data.totalDue - data.dueCount);

  return (
    <div className="space-y-8">
        <Surface className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">{t.home.kicker}</p>
              <h1 className="mt-2 text-4xl font-semibold tracking-tight">
                {hasDue ? (
                  <>
                    <span className="text-accent">{data.dueCount}</span> {language === "zh" ? "道待复习题" : `due problem${data.dueCount === 1 ? "" : "s"}`}
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
              className={buttonClasses({ variant: "primary", className: "px-5 py-2.5" })}
            >
              {hasDue ? t.home.startSession : t.home.openDeck}
              <span aria-hidden>-&gt;</span>
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
              description={
                allDone
                  ? t.home.nextSession
                  : t.home.captureHint
              }
            />
          </Surface>
        )
      )}
    </div>
  );
}

function PublicLanding({ language }: { language: "en" | "zh" }) {
  const copy = language === "zh"
    ? {
        eyebrow: "为真正做过的题建立长期记忆",
        title: "不要只刷过，真正记住。",
        body: "ankify 把你的 LeetCode 题目、提交、失败用例和笔记整理成间隔复习、卡片与针对性测验。网页和 Chrome 扩展共用一次 Google 登录。",
        start: "使用 Google 开始",
        privacy: "隐私政策",
        terms: "使用条款",
        features: [
          ["一键捕获", "在 LeetCode 题目页同步题面、通过与失败提交。"],
          ["FSRS 调度", "按题目安排复习，在遗忘前把关键思路带回来。"],
          ["自己的 AI", "使用你自己的模型 key，从个人上下文生成卡片和测验。"],
        ],
      }
    : {
        eyebrow: "Long-term memory for problems you actually solved",
        title: "Don’t just solve it. Remember it.",
        body: "ankify turns your LeetCode problems, submissions, failed cases, and notes into spaced reviews, cards, and focused quizzes. The web app and Chrome extension share one Google login.",
        start: "Continue with Google",
        privacy: "Privacy policy",
        terms: "Terms of use",
        features: [
          ["One-click capture", "Sync the statement plus accepted and failed submissions from LeetCode."],
          ["FSRS scheduling", "Review whole problems shortly before the important ideas fade."],
          ["Bring your own AI", "Use your own provider key to create cards and quizzes from personal context."],
        ],
      };

  return (
    <div className="mx-auto max-w-5xl space-y-12 py-8 sm:py-14">
      <section className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{copy.eyebrow}</p>
        <h1 className="mt-4 text-5xl font-semibold tracking-tight sm:text-6xl">{copy.title}</h1>
        <p className="mt-6 max-w-2xl text-base leading-8 text-muted sm:text-lg">{copy.body}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/login" className={buttonClasses({ variant: "primary", className: "px-5 py-2.5" })}>
            {copy.start}
            <span aria-hidden>-&gt;</span>
          </Link>
          <Link href="/privacy" className={buttonClasses({ className: "px-5 py-2.5" })}>
            {copy.privacy}
          </Link>
          <Link href="/terms" className={buttonClasses({ className: "px-5 py-2.5" })}>
            {copy.terms}
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {copy.features.map(([title, body]) => (
          <Surface key={title} className="p-5">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted">{body}</p>
          </Surface>
        ))}
      </section>
    </div>
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

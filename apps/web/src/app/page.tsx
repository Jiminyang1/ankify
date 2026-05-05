import Link from "next/link";
import { getDb, schema } from "@ankify/db";
import { asc, desc, eq, isNull, sql } from "drizzle-orm";
import { Surface } from "@/components/ui/surface";
import { DifficultyPill, FsrsStatePill, Pill } from "@/components/ui/pill";
import { dueProblemCondition } from "@/lib/due-problems";
import { getReviewQueueStatus } from "@/lib/review-queue";
import { formatRelative } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function getHomeData() {
  try {
    const db = getDb();
    const now = new Date();

    const [queue, totalRows] = await Promise.all([
      getReviewQueueStatus(db),
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.problems)
        .where(isNull(schema.problems.archivedAt)),
    ]);
    const totalRow = totalRows[0];

    const dueProblems = await db
      .select()
      .from(schema.problems)
      .where(dueProblemCondition(now))
      .orderBy(asc(sql`COALESCE(${schema.problems.fsrsDue}, 0)`), desc(schema.problems.createdAt))
      .limit(Math.min(8, queue.remaining));

    const cardStats = await db
      .select({
        problemId: schema.cards.problemId,
        total: sql<number>`count(*)`,
      })
      .from(schema.cards)
      .where(eq(schema.cards.aiStatus, "ready"))
      .groupBy(schema.cards.problemId);

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
  const data = await getHomeData();
  const hasDue = data.dueCount > 0;
  const allDone = data.totalProblems > 0 && !hasDue;

  return (
    <div className="space-y-8">
        <Surface className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Daily LeetCode review</p>
              <h1 className="mt-2 text-4xl font-semibold tracking-tight">
                {hasDue ? (
                  <>
                    <span className="text-accent">{data.dueCount}</span> due problem{data.dueCount === 1 ? "" : "s"}
                  </>
                ) : allDone ? (
                  "Done for today"
                ) : (
                  "No problems yet"
                )}
              </h1>
            </div>
            <Link
              href={hasDue ? "/review" : "/problems"}
              className="inline-flex items-center justify-center rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white shadow-card transition hover:opacity-90"
            >
              {hasDue ? "Start session" : "Open deck"}
              <span className="ml-2" aria-hidden>
                -&gt;
              </span>
            </Link>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <MiniStat label="Done today" value={data.doneToday} suffix={`/${data.dailyReviewLimit}`} />
            <MiniStat label="Due now" value={data.dueCount} accent={hasDue} />
            <MiniStat label="Deck" value={data.totalProblems} />
          </div>
        </Surface>

      {"error" in data && data.error && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          Database is not initialized. Configure <code className="font-mono">.env.local</code> or{" "}
          <code className="font-mono">.env</code>, then run{" "}
          <code className="font-mono">pnpm db:migrate</code>.
        </div>
      )}

      {data.dueProblems.length > 0 ? (
        <section>
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Today&apos;s queue</h2>
              <p className="mt-1 text-sm text-muted">
                Ordered by review urgency. {data.totalDue > data.dueCount ? `${data.totalDue - data.dueCount} due problem${data.totalDue - data.dueCount === 1 ? "" : "s"} held for later by your daily limit.` : ""}
              </p>
            </div>
            <Link href="/review" className="text-sm font-medium text-accent hover:underline">
              Review now
            </Link>
          </div>

          <ul className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-card">
            {data.dueProblems.map((problem, index) => {
              const cardCount = data.cardsByProblem.get(problem.id) ?? 0;
              return (
                <li key={problem.id}>
                  <Link href={`/problems/${problem.id}`} className="grid gap-3 px-4 py-3 transition hover:bg-subtle sm:grid-cols-[32px_1fr_auto] sm:items-center">
                    <div className="font-mono text-xs text-muted tabular-nums">{String(index + 1).padStart(2, "0")}</div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{problem.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <DifficultyPill difficulty={problem.difficulty} />
                        <FsrsStatePill state={problem.fsrsState} />
                        {problem.topicTags.slice(0, 3).map((tag) => (
                          <span key={tag} className="text-xs text-muted">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs sm:justify-end">
                      <Pill tone={cardCount > 0 ? "accent" : "neutral"}>
                        {cardCount > 0 ? `${cardCount} cards` : "needs cards"}
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
          <Surface className="p-8 text-center">
            <Pill tone={allDone ? "success" : "accent"}>{allDone ? "clear" : "empty deck"}</Pill>
            <p className="mt-3 text-lg font-medium">
              {allDone ? "No reviews are due." : "Capture a LeetCode problem to start."}
            </p>
            <p className="mt-1 text-sm text-muted">
              {allDone ? "The next session appears when a problem becomes due." : "Use the extension from a LeetCode problem page."}
            </p>
          </Surface>
        )
      )}
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

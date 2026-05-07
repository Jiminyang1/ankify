import Link from "next/link";
import { getDb, schema } from "@ankify/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { retrievability, type FsrsCardState } from "@ankify/core";
import { DashboardCharts } from "./charts";
import { DevResetButton } from "./dev-reset";
import { dueProblemCondition } from "@/lib/due-problems";
import { requirePageUser } from "@/lib/auth";
import { DifficultyPill, FsrsStatePill, Pill } from "@/components/ui/pill";
import { Stat, Surface } from "@/components/ui/surface";
import { formatRelative } from "@/lib/utils";

const isDev = process.env.NODE_ENV !== "production";

export const dynamic = "force-dynamic";

type RiskProblem = typeof schema.problems.$inferSelect & {
  retrievabilityNow: number;
  riskScore: number;
};

type StabilityBucket = { label: string; count: number; pct: number };

function toFsrsState(problem: typeof schema.problems.$inferSelect): FsrsCardState {
  return {
    due: problem.fsrsDue,
    stability: problem.fsrsStability,
    difficulty: problem.fsrsDifficulty,
    elapsedDays: problem.fsrsElapsedDays,
    scheduledDays: problem.fsrsScheduledDays,
    reps: problem.fsrsReps,
    lapses: problem.fsrsLapses,
    state: problem.fsrsState,
    lastReview: problem.fsrsLastReview,
  };
}

function stabilityBuckets(problems: (typeof schema.problems.$inferSelect)[]): StabilityBucket[] {
  const buckets = [
    { label: "New", min: -Infinity, max: 0, count: 0 },
    { label: "< 1d", min: 0.01, max: 1, count: 0 },
    { label: "1—7d", min: 1, max: 7, count: 0 },
    { label: "7—30d", min: 7, max: 30, count: 0 },
    { label: "30d+", min: 30, max: Infinity, count: 0 },
  ];
  for (const p of problems) {
    if (p.fsrsReps === 0) { buckets[0]!.count++; continue; }
    const s = p.fsrsStability ?? 0;
    for (const b of buckets) {
      if (s > b.min && s <= b.max) { b.count++; break; }
    }
  }
  const total = problems.length || 1;
  return buckets.map((b) => ({ ...b, pct: Math.round((b.count / total) * 100) }));
}

async function loadAnalysis(userId: string) {
  const db = getDb();
  const now = new Date();
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.problems)
    .where(and(eq(schema.problems.userId, userId), isNull(schema.problems.archivedAt)));

  const [dueRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.problems)
    .where(dueProblemCondition(userId, now));

  const problems = await db
    .select()
    .from(schema.problems)
    .where(and(eq(schema.problems.userId, userId), isNull(schema.problems.archivedAt)));

  /* risk table */
  const riskProblems: RiskProblem[] = problems
    .map((problem) => {
      const state = toFsrsState(problem);
      const r = retrievability(state, now);
      const lapsePenalty = Math.min(problem.fsrsLapses, 4) * 0.08;
      const difficulty = problem.fsrsDifficulty ?? 0;
      const riskScore = (1 - r) + difficulty / 20 + lapsePenalty;
      return { ...problem, retrievabilityNow: r, riskScore };
    })
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 8);

  /* daily review counts */
  const dailyReviews = (await db.all(sql`
    SELECT
      strftime('%Y-%m-%d', occurred_at / 1000, 'unixepoch') as day,
      COUNT(*) as count
    FROM review_events
    WHERE user_id = ${userId} AND event_type = 'self_recall_rated' AND occurred_at >= ${thirtyDaysAgo}
    GROUP BY day
    ORDER BY day ASC
  `)) as { day: string; count: number }[];

  /* memory score — average retrievability across reviewed problems */
  const reviewed = problems.filter((p) => p.fsrsReps > 0);
  const memoryScore =
    reviewed.length > 0
      ? Math.round(
          (reviewed.reduce((sum, p) => sum + retrievability(toFsrsState(p), now), 0) / reviewed.length) * 100,
        )
      : null;

  /* lapse rate */
  const totalReps = reviewed.reduce((s, p) => s + p.fsrsReps, 0);
  const totalLapses = reviewed.reduce((s, p) => s + p.fsrsLapses, 0);
  const lapseRate = totalReps > 0 ? Math.round((totalLapses / totalReps) * 100) : null;

  /* stability distribution */
  const stabilityDist = stabilityBuckets(problems);

  /* state counts */
  const stateCounts = { new: 0, learning: 0, review: 0, relearning: 0 };
  for (const p of problems) stateCounts[p.fsrsState]++;

  /* burden — expected reviews in next 7 days */
  const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const burden7d = reviewed.filter((p) => p.fsrsDue && p.fsrsDue <= nextWeek).length;

  return {
    totalProblems: totalRow?.count ?? 0,
    dueCount: dueRow?.count ?? 0,
    memoryScore,
    lapseRate,
    riskProblems,
    dailyReviews,
    stabilityDist,
    stateCounts,
    burden7d,
  };
}

export default async function AnalysisPage() {
  const user = await requirePageUser();
  let data: Awaited<ReturnType<typeof loadAnalysis>>;
  try {
    data = await loadAnalysis(user.id);
  } catch {
    return (
      <Surface className="p-8">
        <h1 className="text-2xl font-semibold">Analysis</h1>
        <p className="mt-2 text-sm text-danger">
          Database is not initialized. Configure <code className="font-mono">.env.local</code> or{" "}
          <code className="font-mono">.env</code>, then run{" "}
          <code className="font-mono">pnpm db:migrate</code>.
        </p>
      </Surface>
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Analysis</h1>
          <p className="mt-1 text-sm text-muted">Memory health from FSRS data.</p>
        </div>
        <Link href="/" className="text-sm font-medium text-accent hover:underline">
          Back to today
        </Link>
      </header>

      {/* Top stats */}
      <section className="grid gap-3 sm:grid-cols-5">
        <Stat label="Total" value={data.totalProblems} />
        <Stat label="Memory" value={data.memoryScore != null ? `${data.memoryScore}%` : "-"} />
        <Stat label="Lapse rate" value={data.lapseRate != null ? `${data.lapseRate}%` : "-"} tone={data.lapseRate != null && data.lapseRate > 25 ? "danger" : "default"} />
        <Stat label="Due now" value={data.dueCount} tone={data.dueCount > 0 ? "accent" : "default"} />
        <Stat label="Next 7d" value={data.burden7d} />
      </section>

      {/* Memory breakdown */}
      {(data.stateCounts.new + data.stateCounts.learning + data.stateCounts.review + data.stateCounts.relearning) > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">State · Stability</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {/* State distribution */}
            <Surface className="p-4">
              <div className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted">State</div>
              <div className="space-y-2">
                {[
                  { key: "new" as const, label: "New" },
                  { key: "learning" as const, label: "Learning" },
                  { key: "review" as const, label: "Review" },
                  { key: "relearning" as const, label: "Relearning" },
                ].map((st) => {
                  const c = data.stateCounts[st.key];
                  const pct = data.totalProblems > 0 ? Math.round((c / data.totalProblems) * 100) : 0;
                  return (
                    <div key={st.key} className="flex items-center gap-3 text-sm">
                      <span className="w-24 text-muted">{st.label}</span>
                      <div className="h-3 flex-1 overflow-hidden rounded-full bg-subtle">
                        <div
                          className="h-full rounded-full bg-accent/60 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-10 text-right text-xs tabular-nums">{c}</span>
                    </div>
                  );
                })}
              </div>
            </Surface>

            {/* Stability buckets */}
            <Surface className="p-4">
              <div className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted">Stability</div>
              <div className="space-y-2">
                {data.stabilityDist.map((b) => (
                  <div key={b.label} className="flex items-center gap-3 text-sm">
                    <span className="w-16 text-muted">{b.label}</span>
                    <div className="h-3 flex-1 overflow-hidden rounded-full bg-subtle">
                      <div
                        className="h-full rounded-full bg-accent/60 transition-all"
                        style={{ width: `${b.pct}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-xs tabular-nums">{b.count}</span>
                  </div>
                ))}
              </div>
            </Surface>
          </div>
        </section>
      )}

      {/* Risk table */}
      <section>
        <div className="mb-3">
          <h2 className="text-lg font-semibold">Memory risk</h2>
          <p className="mt-1 text-sm text-muted">
            Sorted by low retrievability, high difficulty, and repeated lapses.
          </p>
        </div>
        {data.riskProblems.length === 0 ? (
          <Surface className="p-6 text-sm text-muted">No problems yet.</Surface>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-subtle text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Problem</th>
                  <th className="px-4 py-2 font-medium">State</th>
                  <th className="px-4 py-2 font-medium">Retrievability</th>
                  <th className="px-4 py-2 font-medium">Stability</th>
                  <th className="px-4 py-2 font-medium">Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.riskProblems.map((problem) => (
                  <tr key={problem.id} className="align-top">
                    <td className="px-4 py-3">
                      <Link href={`/problems/${problem.id}`} className="font-medium hover:text-accent">
                        {problem.title}
                      </Link>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <DifficultyPill difficulty={problem.difficulty} />
                        {problem.fsrsLapses > 0 && <Pill tone="danger">{problem.fsrsLapses} lapse{problem.fsrsLapses === 1 ? "" : "s"}</Pill>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <FsrsStatePill state={problem.fsrsState} />
                    </td>
                    <td className="px-4 py-3 tabular-nums">{Math.round(problem.retrievabilityNow * 100)}%</td>
                    <td className="px-4 py-3 tabular-nums">
                      {problem.fsrsStability != null ? `${problem.fsrsStability.toFixed(1)}d` : "-"}
                    </td>
                    <td className="px-4 py-3 text-muted">{formatRelative(problem.fsrsDue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <DashboardCharts dailyReviews={data.dailyReviews} />

      {isDev && (
        <section className="border-t border-border pt-6">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Dev tools</h2>
          <div className="mt-3">
            <DevResetButton />
          </div>
        </section>
      )}
    </div>
  );
}

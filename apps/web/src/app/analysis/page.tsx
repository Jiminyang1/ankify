import Link from "next/link";
import { getDb, schema } from "@ankify/db";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { retrievability, type FsrsCardState } from "@ankify/core";
import { DashboardCharts } from "./charts";
import { DevResetButton } from "./dev-reset";
import { dueProblemCondition } from "@/lib/due-problems";
import { requirePageUser } from "@/lib/auth";
import { getRequestLanguage, getRequestTranslations } from "@/lib/i18n-server";
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

const STABILITY_BUCKET_LABELS = ["New", "< 1d", "1—7d", "7—30d", "30d+"] as const;

async function loadAnalysis(userId: string) {
  const db = getDb();
  const now = new Date();
  const nowMs = now.getTime();
  const thirtyDaysAgo = nowMs - 30 * 24 * 60 * 60 * 1000;
  const nextWeekMs = nowMs + 7 * 24 * 60 * 60 * 1000;

  const reps = schema.problems.fsrsReps;
  const stability = sql`coalesce(${schema.problems.fsrsStability}, 0)`;
  const owns = and(eq(schema.problems.userId, userId), isNull(schema.problems.archivedAt));

  // Everything that doesn't need the FSRS retrievability curve is aggregated in
  // SQL — counts, sums, stability buckets, 7-day burden — so we never pull the
  // whole deck into memory just to reduce it. retrievability() is a JS-only
  // curve computation, and new (reps=0) cards always sit at r=1 with ~0 risk,
  // so the per-row JS pass runs over reviewed problems only.
  const [aggRows, stateRows, dueRow, dailyReviews, reviewedProblems] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)`,
        totalReps: sql<number>`coalesce(sum(case when ${reps} > 0 then ${reps} else 0 end), 0)`,
        totalLapses: sql<number>`coalesce(sum(case when ${reps} > 0 then ${schema.problems.fsrsLapses} else 0 end), 0)`,
        burden7d: sql<number>`coalesce(sum(case when ${reps} > 0 and ${schema.problems.fsrsDue} is not null and ${schema.problems.fsrsDue} <= ${nextWeekMs} then 1 else 0 end), 0)`,
        bNew: sql<number>`coalesce(sum(case when ${reps} = 0 then 1 else 0 end), 0)`,
        bLt1: sql<number>`coalesce(sum(case when ${reps} > 0 and ${stability} > 0.01 and ${stability} <= 1 then 1 else 0 end), 0)`,
        b1to7: sql<number>`coalesce(sum(case when ${reps} > 0 and ${stability} > 1 and ${stability} <= 7 then 1 else 0 end), 0)`,
        b7to30: sql<number>`coalesce(sum(case when ${reps} > 0 and ${stability} > 7 and ${stability} <= 30 then 1 else 0 end), 0)`,
        b30plus: sql<number>`coalesce(sum(case when ${reps} > 0 and ${stability} > 30 then 1 else 0 end), 0)`,
      })
      .from(schema.problems)
      .where(owns),
    db
      .select({ state: schema.problems.fsrsState, count: sql<number>`count(*)` })
      .from(schema.problems)
      .where(owns)
      .groupBy(schema.problems.fsrsState),
    db
      .select({ count: sql<number>`count(*)` })
      .from(schema.problems)
      .where(dueProblemCondition(userId, now)),
    db.all(sql`
      SELECT
        strftime('%Y-%m-%d', occurred_at / 1000, 'unixepoch') as day,
        COUNT(*) as count
      FROM review_events
      WHERE user_id = ${userId} AND event_type = 'self_recall_rated' AND occurred_at >= ${thirtyDaysAgo}
      GROUP BY day
      ORDER BY day ASC
    `) as Promise<{ day: string; count: number }[]>,
    db
      .select()
      .from(schema.problems)
      .where(and(owns, gt(schema.problems.fsrsReps, 0))),
  ]);

  const agg = aggRows[0];
  const total = agg?.total ?? 0;

  /* lapse rate */
  const totalReps = agg?.totalReps ?? 0;
  const lapseRate = totalReps > 0 ? Math.round(((agg?.totalLapses ?? 0) / totalReps) * 100) : null;

  /* stability distribution — counts come from SQL, percent is over the deck */
  const bucketCounts = [agg?.bNew ?? 0, agg?.bLt1 ?? 0, agg?.b1to7 ?? 0, agg?.b7to30 ?? 0, agg?.b30plus ?? 0];
  const bucketDenom = total || 1;
  const stabilityDist: StabilityBucket[] = STABILITY_BUCKET_LABELS.map((label, i) => ({
    label,
    count: bucketCounts[i]!,
    pct: Math.round((bucketCounts[i]! / bucketDenom) * 100),
  }));

  /* state counts */
  const stateCounts = { new: 0, learning: 0, review: 0, relearning: 0 };
  for (const row of stateRows) stateCounts[row.state] = row.count;

  /* per-reviewed-problem retrievability — computed once, reused below */
  const reviewed = reviewedProblems.map((problem) => ({
    problem,
    r: retrievability(toFsrsState(problem), now),
  }));

  const riskProblems: RiskProblem[] = reviewed
    .map(({ problem, r }) => {
      const lapsePenalty = Math.min(problem.fsrsLapses, 4) * 0.08;
      const difficulty = problem.fsrsDifficulty ?? 0;
      const riskScore = (1 - r) + difficulty / 20 + lapsePenalty;
      return { ...problem, retrievabilityNow: r, riskScore };
    })
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 8);

  const memoryScore =
    reviewed.length > 0
      ? Math.round((reviewed.reduce((sum, x) => sum + x.r, 0) / reviewed.length) * 100)
      : null;

  /* problems whose recall has slipped below 70% */
  const atRiskCount = reviewed.filter((x) => x.r < 0.7).length;

  return {
    totalProblems: total,
    dueCount: dueRow[0]?.count ?? 0,
    reviewedCount: reviewed.length,
    memoryScore,
    lapseRate,
    atRiskCount,
    riskProblems,
    dailyReviews,
    stabilityDist,
    stateCounts,
    burden7d: agg?.burden7d ?? 0,
  };
}

/** Red → gold → green by how durable the memory is. */
const STABILITY_BAR_COLOR: Record<string, string> = {
  New: "bg-border",
  "< 1d": "bg-danger/70",
  "1—7d": "bg-warning/70",
  "7—30d": "bg-success/45",
  "30d+": "bg-success/85",
};

/** Low recall reads red, mid reads gold, healthy stays neutral. */
function recallToneClass(pct: number): string {
  if (pct < 50) return "font-medium text-danger";
  if (pct < 70) return "font-medium text-warning";
  return "text-fg";
}

type Headline = { text: string; tone: "default" | "accent" | "success" | "danger" };

function buildHeadline(data: Awaited<ReturnType<typeof loadAnalysis>>, t: Awaited<ReturnType<typeof getRequestTranslations>>): Headline {
  const mem = data.memoryScore != null ? `${data.memoryScore}%` : "—";
  if (data.totalProblems === 0) {
    return { text: t.analysis.headlines.empty, tone: "default" };
  }
  if (data.reviewedCount === 0) {
    return { text: t.analysis.headlines.noneReviewed(data.totalProblems), tone: "accent" };
  }
  if (data.atRiskCount > 0) {
    return { text: t.analysis.headlines.atRisk(data.atRiskCount), tone: "danger" };
  }
  if (data.dueCount > 0) {
    return { text: t.analysis.headlines.due(data.dueCount, mem), tone: "accent" };
  }
  return { text: t.analysis.headlines.caughtUp(mem), tone: "success" };
}

const HEADLINE_TONE: Record<Headline["tone"], string> = {
  default: "border-border bg-subtle text-fg",
  accent: "border-accent/20 bg-accent-soft/40 text-fg",
  success: "border-success/30 bg-success/5 text-fg",
  danger: "border-danger/30 bg-danger/5 text-fg",
};

export default async function AnalysisPage() {
  const user = await requirePageUser();
  const [t, language] = await Promise.all([getRequestTranslations(), getRequestLanguage()]);
  let data: Awaited<ReturnType<typeof loadAnalysis>>;
  try {
    data = await loadAnalysis(user.id);
  } catch {
    return (
      <Surface className="p-8">
        <h1 className="text-2xl font-semibold">{t.analysis.title}</h1>
        <p className="mt-2 text-sm text-danger">
          {t.common.databaseNotInitialized}
        </p>
      </Surface>
    );
  }

  const headline = buildHeadline(data, t);
  const totalStates =
    data.stateCounts.new + data.stateCounts.learning + data.stateCounts.review + data.stateCounts.relearning;
  const memTone =
    data.memoryScore == null ? "default" : data.memoryScore >= 80 ? "success" : data.memoryScore < 60 ? "danger" : "default";

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t.analysis.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {t.analysis.subtitle}
          </p>
        </div>
        <Link href="/" className="text-sm font-medium text-accent hover:underline">
          {t.analysis.backToday}
        </Link>
      </header>

      {/* Plain-language summary */}
      <div className={`rounded-xl border px-4 py-3 text-sm font-medium ${HEADLINE_TONE[headline.tone]}`}>
        {headline.text}
      </div>

      {/* Top stats */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat
          label={t.analysis.memory}
          value={data.memoryScore != null ? `${data.memoryScore}%` : "—"}
          hint={t.analysis.memoryHint}
          info={t.analysis.memoryInfo}
          tone={memTone}
        />
        <Stat
          label={t.analysis.lapseRate}
          value={data.lapseRate != null ? `${data.lapseRate}%` : "—"}
          hint={t.analysis.lapseHint}
          info={t.analysis.lapseInfo}
          tone={data.lapseRate != null && data.lapseRate > 25 ? "danger" : "default"}
        />
        <Stat
          label={t.home.dueNow}
          value={data.dueCount}
          hint={t.analysis.due}
          tone={data.dueCount > 0 ? "accent" : "default"}
        />
        <Stat
          label={t.analysis.next7d}
          value={data.burden7d}
          hint={t.analysis.next7dHint}
          info={t.analysis.next7dInfo}
        />
        <Stat label="Total" value={data.totalProblems} hint={t.analysis.totalHint} />
      </section>

      {/* Risk table — what to act on */}
      <section>
        <div className="mb-3">
          <h2 className="text-lg font-semibold">{t.analysis.needsAttention}</h2>
          <p className="mt-1 text-sm text-muted">
            {t.analysis.riskDescription}
          </p>
          <p className="mt-1 text-xs text-muted">
            {t.analysis.riskLegend}
          </p>
        </div>
        {data.riskProblems.length === 0 ? (
          <Surface className="p-6 text-sm text-muted">{t.analysis.noReviewed}</Surface>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-subtle text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">{t.analysis.problem}</th>
                  <th className="px-4 py-2 font-medium">{t.analysis.state}</th>
                  <th className="px-4 py-2 font-medium">{t.analysis.retrievability}</th>
                  <th className="px-4 py-2 font-medium">{t.analysis.stability}</th>
                  <th className="px-4 py-2 font-medium">{t.analysis.due}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.riskProblems.map((problem) => {
                  const recall = Math.round(problem.retrievabilityNow * 100);
                  return (
                    <tr key={problem.id} className="align-top">
                      <td className="px-4 py-3">
                        <Link href={`/problems/${problem.id}`} className="font-medium hover:text-accent">
                          {problem.title}
                        </Link>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <DifficultyPill difficulty={problem.difficulty} language={language} />
                          {problem.fsrsLapses > 0 && (
                            <Pill tone="danger">
                              {t.common.lapses(problem.fsrsLapses)}
                            </Pill>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <FsrsStatePill state={problem.fsrsState} language={language} />
                      </td>
                      <td className={`px-4 py-3 tabular-nums ${recallToneClass(recall)}`}>{recall}%</td>
                      <td className="px-4 py-3 tabular-nums">
                        {problem.fsrsStability != null ? `${problem.fsrsStability.toFixed(1)}d` : "—"}
                      </td>
                      <td className="px-4 py-3 text-muted">{formatRelative(problem.fsrsDue)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Memory breakdown */}
      {totalStates > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">{t.analysis.memoryBreakdown}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {/* State distribution */}
            <Surface className="p-4">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{t.analysis.state}</div>
              <p className="mt-1 text-xs text-muted">
                {t.analysis.stateDescription}
              </p>
              <div className="mt-3 space-y-2">
                {[
                  { key: "new" as const, label: t.fsrs.new },
                  { key: "learning" as const, label: t.fsrs.learning },
                  { key: "review" as const, label: t.fsrs.review },
                  { key: "relearning" as const, label: t.fsrs.relearning },
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
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{t.analysis.stability}</div>
              <p className="mt-1 text-xs text-muted">
                {t.analysis.stabilityDescription}
              </p>
              <div className="mt-3 space-y-2">
                {data.stabilityDist.map((b) => (
                  <div key={b.label} className="flex items-center gap-3 text-sm">
                    <span className="w-16 text-muted">{b.label}</span>
                    <div className="h-3 flex-1 overflow-hidden rounded-full bg-subtle">
                      <div
                        className={`h-full rounded-full transition-all ${STABILITY_BAR_COLOR[b.label] ?? "bg-accent/60"}`}
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

      <DashboardCharts dailyReviews={data.dailyReviews} />

      {isDev && (
        <section className="border-t border-border pt-6">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">{t.analysis.devTools}</h2>
          <div className="mt-3">
            <DevResetButton />
          </div>
        </section>
      )}
    </div>
  );
}

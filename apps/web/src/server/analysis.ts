import { getDb, schema } from "@ankify/db";
import { retrievability, type FsrsCardState } from "@ankify/core";
import { and, eq, gt, gte, isNull, sql } from "drizzle-orm";
import { dueProblemCondition } from "@/server/due-problems";
import { getReviewSettings } from "@/server/settings";
import { formatDateKeyInTimeZone } from "@/server/time-zone";

const riskProblemColumns = {
  id: schema.problems.id,
  title: schema.problems.title,
  difficulty: schema.problems.difficulty,
  fsrsDue: schema.problems.fsrsDue,
  fsrsStability: schema.problems.fsrsStability,
  fsrsDifficulty: schema.problems.fsrsDifficulty,
  fsrsElapsedDays: schema.problems.fsrsElapsedDays,
  fsrsScheduledDays: schema.problems.fsrsScheduledDays,
  fsrsLearningSteps: schema.problems.fsrsLearningSteps,
  fsrsReps: schema.problems.fsrsReps,
  fsrsLapses: schema.problems.fsrsLapses,
  fsrsState: schema.problems.fsrsState,
  fsrsLastReview: schema.problems.fsrsLastReview,
} as const;

type ReviewedProblem = {
  [K in keyof typeof riskProblemColumns]: (typeof schema.problems.$inferSelect)[K];
};

type RiskProblem = ReviewedProblem & {
  retrievabilityNow: number;
  riskScore: number;
};

type StabilityBucket = { label: string; count: number; pct: number };

const STABILITY_BUCKET_LABELS = ["New", "< 1d", "1—7d", "7—30d", "30d+"] as const;

function toFsrsState(problem: ReviewedProblem): FsrsCardState {
  return {
    due: problem.fsrsDue,
    stability: problem.fsrsStability,
    difficulty: problem.fsrsDifficulty,
    elapsedDays: problem.fsrsElapsedDays,
    scheduledDays: problem.fsrsScheduledDays,
    learningSteps: problem.fsrsLearningSteps,
    reps: problem.fsrsReps,
    lapses: problem.fsrsLapses,
    state: problem.fsrsState,
    lastReview: problem.fsrsLastReview,
  };
}

export async function loadAnalysis(userId: string) {
  const db = getDb();
  const now = new Date();
  const thirtyDaysAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const nextWeekMs = now.getTime() + 7 * 24 * 60 * 60 * 1000;
  const reps = schema.problems.fsrsReps;
  const stability = sql`coalesce(${schema.problems.fsrsStability}, 0)`;
  const owns = and(eq(schema.problems.userId, userId), isNull(schema.problems.archivedAt));

  const [aggRows, stateRows, dueRows, dailyReviewEvents, reviewedProblems, reviewSettings] = await Promise.all([
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
    db
      .select({ occurredAt: schema.reviewEvents.occurredAt })
      .from(schema.reviewEvents)
      .where(
        and(
          eq(schema.reviewEvents.userId, userId),
          eq(schema.reviewEvents.eventType, "self_recall_rated"),
          isNull(schema.reviewEvents.undoneAt),
          gte(schema.reviewEvents.occurredAt, new Date(thirtyDaysAgo)),
        ),
      ),
    db
      .select(riskProblemColumns)
      .from(schema.problems)
      .where(and(owns, gt(schema.problems.fsrsReps, 0))),
    getReviewSettings(userId),
  ]);

  const reviewCounts = new Map<string, number>();
  for (const event of dailyReviewEvents) {
    const day = formatDateKeyInTimeZone(event.occurredAt, reviewSettings.timeZone);
    reviewCounts.set(day, (reviewCounts.get(day) ?? 0) + 1);
  }
  const dailyReviews = [...reviewCounts.entries()]
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const agg = aggRows[0];
  const total = agg?.total ?? 0;
  const totalReps = agg?.totalReps ?? 0;
  const bucketCounts = [agg?.bNew ?? 0, agg?.bLt1 ?? 0, agg?.b1to7 ?? 0, agg?.b7to30 ?? 0, agg?.b30plus ?? 0];
  const stabilityDist: StabilityBucket[] = STABILITY_BUCKET_LABELS.map((label, index) => ({
    label,
    count: bucketCounts[index]!,
    pct: Math.round((bucketCounts[index]! / (total || 1)) * 100),
  }));

  const stateCounts = { new: 0, learning: 0, review: 0, relearning: 0 };
  for (const row of stateRows) stateCounts[row.state] = row.count;

  const reviewed = reviewedProblems.map((problem) => ({
    problem,
    retrievability: retrievability(toFsrsState(problem), now),
  }));
  const riskProblems: RiskProblem[] = reviewed
    .map(({ problem, retrievability: current }) => ({
      ...problem,
      retrievabilityNow: current,
      riskScore: (1 - current) + (problem.fsrsDifficulty ?? 0) / 20 + Math.min(problem.fsrsLapses, 4) * 0.08,
    }))
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 8);

  return {
    totalProblems: total,
    dueCount: dueRows[0]?.count ?? 0,
    reviewedCount: reviewed.length,
    memoryScore:
      reviewed.length > 0
        ? Math.round((reviewed.reduce((sum, item) => sum + item.retrievability, 0) / reviewed.length) * 100)
        : null,
    lapseRate: totalReps > 0 ? Math.round(((agg?.totalLapses ?? 0) / totalReps) * 100) : null,
    atRiskCount: reviewed.filter((item) => item.retrievability < 0.7).length,
    riskProblems,
    dailyReviews,
    stabilityDist,
    stateCounts,
    burden7d: agg?.burden7d ?? 0,
  };
}

export type AnalysisData = Awaited<ReturnType<typeof loadAnalysis>>;

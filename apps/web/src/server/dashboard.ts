import type { PracticeSessionTypeId, ReviewOverviewDto, SkillDimensionId } from "@ankify/contracts";
import { getDb, schema } from "@ankify/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { loadMistakeProfile } from "./mistake-profile";
import { loadReviewOverview } from "./review-overview";
import { listSuggestions } from "./suggestions/commands";

const WEEK_MS = 7 * 86_400_000;
const RECENT_SESSIONS = 8;

export type DashboardSession = {
  id: string;
  problemId: string;
  title: string;
  type: PracticeSessionTypeId;
  status: "active" | "interrupted" | "completed" | "abandoned";
  outcome: "accepted" | "failed" | "unknown" | null;
  at: Date;
};

export type Dashboard = {
  overview: ReviewOverviewDto;
  recent: DashboardSession[];
  /** Completed sessions in the last seven days, by outcome. */
  week: { completed: number; accepted: number; failed: number };
  profile: { personalized: boolean; focus: { category: SkillDimensionId; contexts: number; problems: number }[] };
  pendingSuggestions: number;
};

/** The web dashboard: the popup's overview plus recent practice, all user-scoped. */
export async function loadDashboard(userId: string, now = new Date()): Promise<Dashboard> {
  const db = getDb();
  const ps = schema.practiceSessions;
  const p = schema.problems;
  const [overview, recent, [week], profile, suggestions] = await Promise.all([
    loadReviewOverview(userId, 10),
    db
      .select({ id: ps.id, problemId: ps.problemId, title: p.title, type: ps.type, status: ps.status, outcome: ps.outcome, startedAt: ps.startedAt, completedAt: ps.completedAt })
      .from(ps)
      .innerJoin(p, and(eq(p.id, ps.problemId), eq(p.userId, ps.userId)))
      .where(eq(ps.userId, userId))
      .orderBy(desc(ps.startedAt), desc(ps.id))
      .limit(RECENT_SESSIONS),
    db
      .select({
        completed: sql<number>`count(*)`,
        accepted: sql<number>`coalesce(sum(case when ${ps.outcome} = 'accepted' then 1 else 0 end), 0)`,
        failed: sql<number>`coalesce(sum(case when ${ps.outcome} = 'failed' then 1 else 0 end), 0)`,
      })
      .from(ps)
      .where(and(eq(ps.userId, userId), eq(ps.status, "completed"), gte(ps.completedAt, new Date(now.getTime() - WEEK_MS)))),
    loadMistakeProfile(userId, now),
    listSuggestions(userId, now),
  ]);
  return {
    overview,
    recent: recent.map((row) => ({ id: row.id, problemId: row.problemId, title: row.title, type: row.type, status: row.status, outcome: row.outcome, at: row.completedAt ?? row.startedAt })),
    week: { completed: week?.completed ?? 0, accepted: week?.accepted ?? 0, failed: week?.failed ?? 0 },
    profile: {
      personalized: profile.readiness.personalized,
      focus: profile.categories
        .filter((category) => category.weak && category.ready)
        .sort((a, b) => b.weakness - a.weakness)
        .slice(0, 3)
        .map(({ category, contexts, problems }) => ({ category, contexts, problems })),
    },
    pendingSuggestions: suggestions.suggestions.filter((suggestion) => suggestion.status === "pending").length,
  };
}

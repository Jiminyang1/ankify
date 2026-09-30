import type { SuggestionDto } from "@ankify/contracts";
import { contextKey, FEED_PARAMS, planSuggestion, type LeetCodeDifficulty, type SkillDimension, type SuggestionCandidate, type SuggestionPlanInput } from "@ankify/core";
import { getDb, schema, type PracticeSession, type Suggestion } from "@ankify/db";
import { and, desc, eq, gte, inArray, or } from "drizzle-orm";
import { legacySourceKey, loadMistakeProfile } from "../mistake-profile";
import type { DbTransaction } from "../practice-sessions/store";
import { getReviewSettings } from "../settings";
import { formatDateKeyInTimeZone } from "../time-zone";
import { catalogCandidates } from "./catalog";
import { historyNovelty, loadKnownAttemptedSlugs } from "./history";

const DAY_MS = 86_400_000;
/** History the planner sees: its exposure window plus a margin. */
const HISTORY_DAYS = 31;
const RECENT_SESSIONS = 10;

/** What a plan needs that is read outside the write transaction. */
export type PlanningContext = {
  dateKey: string;
  profile: SuggestionPlanInput["profile"];
};

export async function loadPlanningContext(userId: string, now: Date): Promise<PlanningContext> {
  const [review, profile] = await Promise.all([getReviewSettings(userId), loadMistakeProfile(userId, now)]);
  return {
    dateKey: formatDateKeyInTimeZone(now, review.timeZone),
    profile: {
      personalized: profile.readiness.personalized,
      categories: profile.categories.map(({ category, weakness, weak, ready, contexts }) => ({ category, weakness, weak, ready, contexts })),
      topics: profile.topics.map(({ topic, sessions }) => ({ topic, sessions })),
    },
  };
}

/** `YYYY-MM-DD`, `days` before the given local date. */
function dateKeyBefore(dateKey: string, days: number) {
  return new Date(Date.parse(`${dateKey}T00:00:00.000Z`) - days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Plans the next suggestion from the user's rows, read inside the allocating
 * transaction so concurrent allocations see each other. Returns the plan with
 * the chosen target's verification time and the history's novelty label.
 */
export async function planNext(tx: DbTransaction, userId: string, context: PlanningContext, ordinal: number, now: Date) {
  const p = schema.problems;
  const m = schema.mistakeRecords;
  const s = schema.suggestions;
  const ps = schema.practiceSessions;
  const since = new Date(now.getTime() - FEED_PARAMS.maxEvidenceAgeDays * DAY_MS);
  const [problems, confirmed, stored, history, recent, attempted, novelty] = await Promise.all([
    tx.select({ id: p.id, title: p.title, difficulty: p.difficulty, topics: p.topicTags, similarSlugs: p.similarSlugs }).from(p).where(eq(p.userId, userId)),
    tx
      .select({
        id: m.id,
        problemId: m.problemId,
        category: m.primaryCategory,
        practiceSessionId: m.practiceSessionId,
        submissionId: m.submissionId,
        quizSessionId: m.quizSessionId,
        quizItemId: m.quizItemId,
        reviewEventId: m.reviewEventId,
      })
      .from(m)
      .where(and(eq(m.userId, userId), eq(m.status, "confirmed"), gte(m.createdAt, since))),
    tx.select().from(schema.suggestionCandidates).where(eq(schema.suggestionCandidates.userId, userId)),
    tx
      .select({ dateKey: s.dateKey, slug: s.slug, category: s.category, status: s.status })
      .from(s)
      .where(and(eq(s.userId, userId), or(gte(s.dateKey, dateKeyBefore(context.dateKey, HISTORY_DAYS)), eq(s.status, "pending")))),
    tx
      .select({ difficulty: p.difficulty })
      .from(ps)
      .innerJoin(p, and(eq(p.id, ps.problemId), eq(p.userId, ps.userId)))
      .where(and(eq(ps.userId, userId), eq(ps.status, "completed")))
      .orderBy(desc(ps.completedAt))
      .limit(RECENT_SESSIONS),
    loadKnownAttemptedSlugs(tx, userId),
    historyNovelty(tx, userId, now),
  ]);

  // Distinct confirmed contexts per problem and category, counted as the profile counts them.
  const contexts = new Map<string, Map<SkillDimension, Set<string>>>();
  for (const row of confirmed) {
    const byCategory = contexts.get(row.problemId) ?? new Map<SkillDimension, Set<string>>();
    const keys = byCategory.get(row.category) ?? new Set<string>();
    keys.add(contextKey({ practiceSessionId: row.practiceSessionId, legacySourceKey: legacySourceKey(row) }));
    byCategory.set(row.category, keys);
    contexts.set(row.problemId, byCategory);
  }

  const candidates: SuggestionCandidate[] = [
    ...stored.map((row) => ({ slug: row.slug, title: row.title, difficulty: row.difficulty, paidOnly: row.paidOnly, topicTags: row.topicTags, verifiedAt: row.verifiedAt })),
    ...catalogCandidates(),
  ];
  const plan = planSuggestion({
    seed: userId,
    dateKey: context.dateKey,
    ordinal,
    profile: context.profile,
    problems: problems.map((problem) => ({
      ...problem,
      confirmedContexts: Object.fromEntries([...(contexts.get(problem.id) ?? new Map()).entries()].map(([category, keys]) => [category, keys.size])),
    })),
    candidates,
    attempted,
    history: history.map((row) => ({ dateKey: row.dateKey, slug: row.slug, category: row.category, pending: row.status === "pending" })),
    recentDifficulties: recent.map((row) => row.difficulty as LeetCodeDifficulty),
  });
  if (plan.kind === "none") return { plan, verifiedAt: null, novelty };
  // The planner uses the most recently verified metadata of a slug.
  const verifiedAt = candidates
    .filter((candidate) => candidate.slug === plan.target.slug && candidate.verifiedAt)
    .reduce((latest, candidate) => (candidate.verifiedAt! > latest ? candidate.verifiedAt! : latest), new Date(0));
  return { plan, verifiedAt, novelty };
}

export function toSuggestionDto(row: Suggestion, session: Pick<PracticeSession, "status" | "outcome"> | null): SuggestionDto {
  return {
    id: row.id,
    dateKey: row.dateKey,
    ordinal: row.ordinal,
    kind: row.kind,
    replacesId: row.replacesId,
    target: {
      slug: row.slug,
      title: row.title,
      difficulty: row.difficulty,
      topicTags: row.topicTags,
      url: `https://leetcode.com/problems/${row.slug}/`,
    },
    category: row.category,
    lane: row.lane,
    reasons: row.reasons,
    plannerVersion: row.plannerVersion,
    novelty: row.novelty,
    status: row.status,
    practiceSessionId: row.practiceSessionId,
    outcome: session?.status === "completed" ? session.outcome : null,
    verifiedAt: row.verifiedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    actedAt: row.actedAt?.toISOString() ?? null,
  };
}

/** DTOs for rows, with each started session's result (user-scoped). */
export async function toSuggestionDtos(db: ReturnType<typeof getDb> | DbTransaction, userId: string, rows: readonly Suggestion[]) {
  const ids = [...new Set(rows.flatMap((row) => (row.practiceSessionId ? [row.practiceSessionId] : [])))];
  const ps = schema.practiceSessions;
  const found =
    ids.length === 0
      ? []
      : await db.select({ id: ps.id, status: ps.status, outcome: ps.outcome }).from(ps).where(and(eq(ps.userId, userId), inArray(ps.id, ids)));
  const sessions = new Map(found.map(({ id, ...session }) => [id, session]));
  return rows.map((row) => toSuggestionDto(row, row.practiceSessionId ? (sessions.get(row.practiceSessionId) ?? null) : null));
}

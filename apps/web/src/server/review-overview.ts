import type { ReviewOverviewDto, ReviewOverviewProblemDto, ReviewOverviewSessionDto } from "@ankify/contracts";
import { effectiveRatingDisposition, isSessionStale } from "@ankify/core";
import { getDb, schema, type PracticeSession, type Problem } from "@ankify/db";
import { and, asc, eq, gt, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { dueProblemCondition } from "./due-problems";
import { loadSessionEvidence, toPracticeSessionDto, toProblemStatusDto } from "./practice-sessions/dto";
import { getReviewQueueStatus } from "./review-queue";
import { getReviewSettings } from "./settings";
import { formatDateKeyInTimeZone, getZonedDayBounds } from "./time-zone";

const UPCOMING_DAYS = 7;
const UPCOMING_LIMIT = 20;
const DAY_MS = 86_400_000;

function dayNumber(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!) / DAY_MS;
}

/**
 * The popup's daily view: what is due (most overdue first, within the daily
 * limit), what comes next, which reviews await a rating, and which sessions
 * can be resumed. Reviews, initial learning, and completed sessions are
 * counted separately; initial learning is never counted as a review.
 */
export async function loadReviewOverview(userId: string, cap = 20, now = new Date()): Promise<ReviewOverviewDto> {
  const db = getDb();
  const p = schema.problems;
  const ps = schema.practiceSessions;
  const [review, queue] = await Promise.all([getReviewSettings(userId), getReviewQueueStatus(userId)]);
  const { start: startOfDay } = getZonedDayBounds(review.timeZone, now);
  const todayKey = formatDateKeyInTimeZone(now, review.timeZone);
  const scheduled = and(eq(p.userId, userId), isNull(p.archivedAt), eq(p.enrollment, "enrolled"));
  const weekEnd = new Date(now.getTime() + UPCOMING_DAYS * DAY_MS);
  const limit = Math.max(0, Math.min(cap, queue.remaining));
  const count = sql<number>`count(*)`;

  const [dueRows, upcomingRows, [counts], openRows, ratableRows, [today]] = await Promise.all([
    limit > 0
      ? db.select().from(p).where(dueProblemCondition(userId, now)).orderBy(asc(sql`COALESCE(${p.fsrsDue}, 0)`), asc(p.id)).limit(limit)
      : Promise.resolve([] as Problem[]),
    db.select().from(p).where(and(scheduled, gt(p.fsrsDue, now), lte(p.fsrsDue, weekEnd))).orderBy(asc(p.fsrsDue), asc(p.id)).limit(UPCOMING_LIMIT),
    db
      .select({
        overdue: sql<number>`coalesce(sum(case when ${p.enrollment} = 'enrolled' and (${p.fsrsDue} is null or ${p.fsrsDue} < ${startOfDay.getTime()}) then 1 else 0 end), 0)`,
        upcomingWeek: sql<number>`coalesce(sum(case when ${p.enrollment} = 'enrolled' and ${p.fsrsDue} > ${now.getTime()} and ${p.fsrsDue} <= ${weekEnd.getTime()} then 1 else 0 end), 0)`,
        awaitingInitial: sql<number>`coalesce(sum(case when ${p.enrollment} = 'awaiting_initial' then 1 else 0 end), 0)`,
      })
      .from(p)
      .where(and(eq(p.userId, userId), isNull(p.archivedAt))),
    db.select().from(ps).where(and(eq(ps.userId, userId), eq(ps.isOpen, true))).orderBy(asc(ps.startedAt)),
    db
      .select()
      .from(ps)
      .where(and(eq(ps.userId, userId), inArray(ps.ratingDisposition, ["pending", "deferred"]), gt(ps.ratingExpiresAt, now)))
      .orderBy(asc(ps.completedAt)),
    db
      .select({
        initialLearning: sql<number>`coalesce(sum(case when ${schema.reviewEvents.eventType} = 'fsrs_scheduled' then 1 else 0 end), 0)`,
      })
      .from(schema.reviewEvents)
      .where(and(eq(schema.reviewEvents.userId, userId), gte(schema.reviewEvents.occurredAt, startOfDay))),
  ]);
  const [dueNow, sessionsToday] = await Promise.all([
    db.select({ count }).from(p).where(dueProblemCondition(userId, now)),
    db
      .select({ count })
      .from(ps)
      .where(and(eq(ps.userId, userId), eq(ps.status, "completed"), gte(ps.completedAt, startOfDay))),
  ]);

  const sessionRows = [...openRows.filter((row) => !isSessionStale(row, now)), ...ratableRows];
  const problemIds = [...new Set(sessionRows.map((row) => row.problemId))];
  const [sessionProblems, evidence] = await Promise.all([
    problemIds.length ? db.select().from(p).where(and(eq(p.userId, userId), inArray(p.id, problemIds))) : Promise.resolve([] as Problem[]),
    loadSessionEvidence(db, userId, sessionRows.map((row) => row.id)),
  ]);
  const problemById = new Map(sessionProblems.map((row) => [row.id, row]));
  const withProblem = (row: PracticeSession): ReviewOverviewSessionDto | null => {
    const problem = problemById.get(row.problemId);
    if (!problem) return null;
    return {
      session: toPracticeSessionDto(row, { problemScheduleRevision: problem.scheduleRevision, evidence: evidence.get(row.id), now }),
      problem: toProblemStatusDto(problem, now),
    };
  };
  const openSessions = openRows.filter((row) => !isSessionStale(row, now)).flatMap((row) => withProblem(row) ?? []);
  const pendingRatings = ratableRows
    .filter((row) => {
      const problem = problemById.get(row.problemId);
      const disposition = problem ? effectiveRatingDisposition(row, problem.scheduleRevision, now) : null;
      return disposition === "pending" || disposition === "deferred";
    })
    .flatMap((row) => withProblem(row) ?? []);

  const openByProblem = new Map(openSessions.map((item) => [item.problem.id, item.session.id]));
  const toItem = (problem: Problem): ReviewOverviewProblemDto => ({
    id: problem.id,
    leetcodeSlug: problem.leetcodeSlug,
    title: problem.title,
    difficulty: problem.difficulty,
    url: problem.url,
    fsrsState: problem.fsrsState,
    fsrsDue: problem.fsrsDue?.toISOString() ?? null,
    overdueDays: problem.fsrsDue
      ? Math.max(0, dayNumber(todayKey) - dayNumber(formatDateKeyInTimeZone(problem.fsrsDue, review.timeZone)))
      : 0,
    openSessionId: openByProblem.get(problem.id) ?? null,
  });

  return {
    serverNow: now.toISOString(),
    timeZone: review.timeZone,
    queue,
    due: dueRows.map(toItem),
    upcoming: upcomingRows.map(toItem),
    pendingRatings,
    openSessions,
    counts: {
      dueNow: Number(dueNow[0]?.count ?? 0),
      overdue: Number(counts?.overdue ?? 0),
      upcomingWeek: Number(counts?.upcomingWeek ?? 0),
      awaitingInitial: Number(counts?.awaitingInitial ?? 0),
      reviewsToday: queue.doneToday,
      initialLearningToday: Number(today?.initialLearning ?? 0),
      sessionsCompletedToday: Number(sessionsToday[0]?.count ?? 0),
    },
  };
}

import type {
  PracticeProblemStatusDto,
  PracticeSessionDto,
  PracticeSessionObservationDto,
} from "@ankify/contracts";
import {
  effectiveRatingDisposition,
  effectiveSessionStatus,
  hasLiveLease,
  isSessionStale,
} from "@ankify/core";
import { getDb, schema, type PracticeSession, type PracticeSessionSubmission, type Problem } from "@ankify/db";
import { and, eq, inArray, sql } from "drizzle-orm";

type DbExecutor = ReturnType<typeof getDb> | Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export type SessionEvidence = PracticeSessionDto["evidence"];

const NO_EVIDENCE: SessionEvidence = {
  submissions: 0,
  accepted: 0,
  failed: 0,
  pendingDetails: 0,
  ambiguous: 0,
  firstAcceptedAt: null,
};

const COMPLETENESS_ORDER = ["complete", "partial", "unavailable"] as const;

/** Evidence counts per session. Only associated observations (automatic or
 *  user-confirmed) count as evidence; ambiguous ones are reported apart. */
export async function loadSessionEvidence(
  db: DbExecutor,
  userId: string,
  sessionIds: string[],
): Promise<Map<string, SessionEvidence>> {
  if (sessionIds.length === 0) return new Map();
  const o = schema.practiceSessionSubmissions;
  const associated = sql`${o.association} IN ('automatic', 'confirmed')`;
  const rows = await db
    .select({
      sessionId: o.sessionId,
      submissions: sql<number>`coalesce(sum(case when ${associated} then 1 else 0 end), 0)`,
      accepted: sql<number>`coalesce(sum(case when ${associated} and ${o.verdict} = 'Accepted' then 1 else 0 end), 0)`,
      failed: sql<number>`coalesce(sum(case when ${associated} and ${o.verdict} <> 'Accepted' then 1 else 0 end), 0)`,
      pendingDetails: sql<number>`coalesce(sum(case when ${associated} and ${o.detailStatus} <> 'complete' then 1 else 0 end), 0)`,
      ambiguous: sql<number>`coalesce(sum(case when ${o.association} = 'ambiguous' then 1 else 0 end), 0)`,
      firstAcceptedAt: sql<number | null>`min(case when ${associated} and ${o.verdict} = 'Accepted' then coalesce(${o.submittedAt}, ${o.firstObservedAt}) end)`,
    })
    .from(o)
    .where(and(eq(o.userId, userId), inArray(o.sessionId, sessionIds)))
    .groupBy(o.sessionId);
  return new Map(
    rows.map((row) => [
      row.sessionId,
      {
        submissions: Number(row.submissions),
        accepted: Number(row.accepted),
        failed: Number(row.failed),
        pendingDetails: Number(row.pendingDetails),
        ambiguous: Number(row.ambiguous),
        firstAcceptedAt: row.firstAcceptedAt == null ? null : new Date(Number(row.firstAcceptedAt)).toISOString(),
      },
    ]),
  );
}

export function toPracticeSessionDto(
  row: PracticeSession,
  context: {
    problemScheduleRevision: number;
    evidence?: SessionEvidence;
    /** The requesting tab's owner token, when it sent one. */
    ownerToken?: string | null;
    now: Date;
  },
): PracticeSessionDto {
  const { now } = context;
  const evidence = context.evidence ?? NO_EVIDENCE;
  const end = row.completedAt ?? now;
  const completeness =
    evidence.pendingDetails > 0 && row.captureCompleteness === "complete" ? "partial" : row.captureCompleteness;
  return {
    id: row.id,
    problemId: row.problemId,
    type: row.type,
    reviewMethod: row.reviewMethod,
    reviewIntent: row.reviewIntent,
    status: effectiveSessionStatus(row, now),
    stale: isSessionStale(row, now),
    outcome: row.outcome,
    revision: row.revision,
    ownership: !row.isOpen
      ? "none"
      : context.ownerToken && row.ownerToken === context.ownerToken
        ? "you"
        : hasLiveLease(row, now)
          ? "other_tab"
          : "none",
    rating: {
      disposition: effectiveRatingDisposition(row, context.problemScheduleRevision, now),
      expiresAt: row.ratingExpiresAt?.toISOString() ?? null,
    },
    capture: { completeness, baselineState: row.baselineState, baselineSubmissionId: row.baselineSubmissionId },
    timing: {
      startedAt: row.startedAt.toISOString(),
      lastActivityAt: row.lastActivityAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      completedAtAdjusted: row.completedAtAdjusted,
      wallMs: Math.max(0, end.getTime() - row.startedAt.getTime()),
      activeMs: row.activeMs + row.ownerActiveMs,
      observedMs: row.observedMs + row.ownerObservedMs,
    },
    evidence,
    sourceAccount: row.sourceAccount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The worse of two completeness levels. */
export function worseCompleteness(
  a: PracticeSession["captureCompleteness"],
  b: PracticeSession["captureCompleteness"],
): PracticeSession["captureCompleteness"] {
  return COMPLETENESS_ORDER.indexOf(a) >= COMPLETENESS_ORDER.indexOf(b) ? a : b;
}

export function isProblemDue(problem: Problem, now: Date) {
  return (
    problem.enrollment === "enrolled" &&
    problem.archivedAt == null &&
    (problem.fsrsDue == null || problem.fsrsDue.getTime() <= now.getTime())
  );
}

export function toProblemStatusDto(problem: Problem, now: Date): PracticeProblemStatusDto {
  return {
    id: problem.id,
    leetcodeSlug: problem.leetcodeSlug,
    title: problem.title,
    difficulty: problem.difficulty,
    url: problem.url,
    enrollment: problem.enrollment,
    archived: problem.archivedAt != null,
    fsrsState: problem.fsrsState,
    fsrsDue: problem.fsrsDue?.toISOString() ?? null,
    due: isProblemDue(problem, now),
    scheduleRevision: problem.scheduleRevision,
  };
}

export function toObservationDto(row: PracticeSessionSubmission): PracticeSessionObservationDto {
  return {
    id: row.id,
    leetcodeSubmissionId: row.leetcodeSubmissionId,
    clientObservationId: row.clientObservationId,
    submissionId: row.submissionId,
    verdict: row.verdict,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    firstObservedAt: row.firstObservedAt.toISOString(),
    detailStatus: row.detailStatus,
    association: row.association,
  };
}

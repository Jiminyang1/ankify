import type { PracticeSessionRatingInput, PracticeSessionRatingResponseDto } from "@ankify/contracts";
import {
  effectiveRatingDisposition,
  initialReviewDue,
  rateFullSolve,
  retrievability,
  SCHEDULING_POLICIES,
} from "@ankify/core";
import { getDb, schema, type PracticeSession, type Problem } from "@ankify/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { markFirstReview } from "@/server/onboarding";
import { fsrsWriteColumns, problemFsrsState, undoRatingEvent, undoSnapshot } from "@/server/review-commands";
import { payloadDigest } from "./digest";
import { toProblemStatusDto } from "./dto";
import {
  fail,
  findReplay,
  loadProblem,
  loadSession,
  recordCommand,
  sessionDto,
  updateSession,
  type DbTransaction,
  type SessionFailure,
} from "./store";

type RateResult = { ok: true; response: PracticeSessionRatingResponseDto } | SessionFailure;

/**
 * Completing initial learning schedules the first review `delayHours` after
 * completion. The FSRS state stays `new` with no review recorded (no recall
 * rating is invented); an `fsrs_scheduled` event records the policy. Only a
 * problem still awaiting initial learning is initialized, exactly once.
 */
export async function initializeProblemSchedule(
  tx: DbTransaction,
  userId: string,
  session: PracticeSession,
  completedAt: Date,
  delayHours: number,
  now: Date,
): Promise<Problem | null> {
  const p = schema.problems;
  const due = initialReviewDue(completedAt, delayHours);
  const [problem] = await tx
    .update(p)
    .set({ enrollment: "enrolled", fsrsDue: due, scheduleRevision: sql`${p.scheduleRevision} + 1`, updatedAt: now })
    .where(and(eq(p.id, session.problemId), eq(p.userId, userId), eq(p.enrollment, "awaiting_initial")))
    .returning();
  if (!problem) return null;
  await tx.insert(schema.reviewEvents).values({
    id: nanoid(12),
    userId,
    problemId: problem.id,
    eventType: "fsrs_scheduled",
    practiceSessionId: session.id,
    policyVersion: SCHEDULING_POLICIES.initialDelay,
    reviewMethod: "leetcode_full_solve",
    scheduleRevision: problem.scheduleRevision,
    metadata: { initialReview: { delayHours, due: due.toISOString(), completedAt: completedAt.toISOString() } },
    occurredAt: completedAt,
  });
  return problem;
}

/**
 * The one FSRS rating of a completed review. In one transaction: check the
 * session is a completed review whose rating is still pending or deferred and
 * whose problem schedule is unchanged since it started; compute FSRS once from
 * the completion time; write the problem with the next schedule revision; add
 * the session-linked event (unique per session); mark the session rated; and
 * store the response for replay. A replay returns that response unless the
 * rating was since undone; any other rating for the session is refused.
 */
export async function ratePracticeSession(
  userId: string,
  sessionId: string,
  input: PracticeSessionRatingInput,
  now = new Date(),
): Promise<RateResult> {
  const digest = payloadDigest({ sessionId, command: "rate", rating: input.rating });
  const result = await getDb().transaction(async (tx): Promise<RateResult> => {
    const replay = await findReplay(tx, userId, input.requestId);
    const session = await loadSession(tx, userId, sessionId);
    if (replay) {
      if (replay.sessionId !== sessionId || replay.command !== "rate" || replay.payloadDigest !== digest) {
        return fail("request_conflict");
      }
      if (session?.ratingDisposition === "undone") {
        const problem = (await loadProblem(tx, userId, session.problemId))!;
        return fail("rating_not_pending", await sessionDto(tx, userId, session, problem, now));
      }
      return { ok: true, response: { ...(replay.response as PracticeSessionRatingResponseDto), idempotentReplay: true } };
    }
    if (!session) return fail("session_not_found");
    const problem = (await loadProblem(tx, userId, session.problemId))!;
    const dtoOf = (row: PracticeSession, revision = problem) => sessionDto(tx, userId, row, revision, now);

    if (session.type !== "scheduled_review" || session.status !== "completed" || !session.completedAt) {
      return fail("rating_not_pending", await dtoOf(session));
    }
    const disposition = effectiveRatingDisposition(session, problem.scheduleRevision, now);
    if (disposition !== "pending" && disposition !== "deferred") {
      const current =
        disposition === session.ratingDisposition
          ? session
          : await updateSession(tx, userId, session, { ratingDisposition: disposition }, now);
      return fail("rating_not_pending", await dtoOf(current));
    }
    const [existing] = await tx
      .select({ id: schema.reviewEvents.id })
      .from(schema.reviewEvents)
      .where(
        and(
          eq(schema.reviewEvents.userId, userId),
          eq(schema.reviewEvents.practiceSessionId, session.id),
          eq(schema.reviewEvents.eventType, "self_recall_rated"),
        ),
      )
      .limit(1);
    if (existing) return fail("rating_not_pending", await dtoOf(session));

    const reviewedAt = session.completedAt;
    const state = problemFsrsState(problem);
    const { next } = rateFullSolve(state, input.rating, reviewedAt);
    const p = schema.problems;
    const [updated] = await tx
      .update(p)
      .set({ ...fsrsWriteColumns(next), updatedAt: now })
      .where(and(eq(p.id, problem.id), eq(p.userId, userId), eq(p.scheduleRevision, session.scheduleRevisionAtStart)))
      .returning();
    if (!updated) return fail("rating_not_pending", await dtoOf(session));

    await tx.insert(schema.reviewEvents).values({
      id: nanoid(12),
      userId,
      problemId: problem.id,
      eventType: "self_recall_rated",
      fsrsRating: input.rating,
      requestId: input.requestId,
      practiceSessionId: session.id,
      policyVersion: SCHEDULING_POLICIES.leetcodeFullSolve,
      reviewMethod: "leetcode_full_solve",
      scheduleRevision: updated.scheduleRevision,
      fsrsStabilitySnap: next.stability,
      fsrsDifficultySnap: next.difficulty,
      fsrsRetrievabilitySnap: state.state === "new" ? null : retrievability(state, reviewedAt),
      metadata: {
        undo: undoSnapshot(state),
        result: { nextDue: next.due?.toISOString() ?? null },
        ratedAt: now.toISOString(),
      },
      occurredAt: reviewedAt,
    });
    const rated = await updateSession(tx, userId, session, { ratingDisposition: "submitted" }, now);
    const response: PracticeSessionRatingResponseDto = {
      ok: true,
      session: await dtoOf(rated, updated),
      problem: toProblemStatusDto(updated, now),
      nextDue: next.due?.toISOString() ?? null,
      idempotentReplay: false,
    };
    await recordCommand(tx, { userId, sessionId, requestId: input.requestId, command: "rate", payloadDigest: digest, response }, now);
    return { ok: true, response };
  });

  if (result.ok && !result.response.idempotentReplay) {
    await markFirstReview(userId).catch((error) => {
      console.warn("[onboarding] failed to record first review", error);
    });
  }
  return result;
}

/** Undo for a session's rating (see `undoRatingEvent`). */
export async function undoSessionRating(tx: DbTransaction, userId: string, session: PracticeSession, now: Date) {
  const [event] = await tx
    .select()
    .from(schema.reviewEvents)
    .where(
      and(
        eq(schema.reviewEvents.userId, userId),
        eq(schema.reviewEvents.practiceSessionId, session.id),
        eq(schema.reviewEvents.eventType, "self_recall_rated"),
        isNull(schema.reviewEvents.undoneAt),
      ),
    )
    .limit(1);
  if (!event) return { ok: false as const, error: "nothing_to_undo" as const };
  return undoRatingEvent(tx, userId, event, now);
}

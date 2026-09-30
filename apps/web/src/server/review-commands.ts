import type {
  ReviewRateResponseDto,
  ReviewRatingInput,
  ReviewUndoInput,
  ReviewUndoResponseDto,
} from "@ankify/contracts";
import { rate, retrievability, SCHEDULING_POLICIES, type FsrsCardState } from "@ankify/core";
import { getDb, schema, type Problem, type ReviewEvent } from "@ankify/db";
import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { markFirstReview } from "./onboarding";
import { getReviewQueueStatus } from "./review-queue";

type DbTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

type RateReviewResult =
  | ReviewRateResponseDto
  | {
      ok: false;
      error: "problem_not_found" | "problem_not_enrolled" | "fsrs_race_conflict" | "review_request_conflict";
    };

type UndoReviewResult =
  | ReviewUndoResponseDto
  | {
      ok: false;
      error: "problem_not_found" | "nothing_to_undo" | "undo_conflict";
    };

const undoSnapshotSchema = z.object({
  due: z.string().nullable(),
  stability: z.number().nullable(),
  difficulty: z.number().nullable(),
  elapsedDays: z.number().nullable(),
  scheduledDays: z.number().nullable(),
  learningSteps: z.number().int().nonnegative().default(0),
  reps: z.number().int(),
  lapses: z.number().int(),
  state: z.enum(["new", "learning", "review", "relearning"]),
  lastReview: z.string().nullable(),
});

export function problemFsrsState(problem: Problem): FsrsCardState {
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

/** Problem columns for a new FSRS state. Every write also advances the
 *  schedule revision so stale pending ratings and Undo are detected. */
export function fsrsWriteColumns(next: FsrsCardState) {
  return {
    fsrsDue: next.due,
    fsrsStability: next.stability,
    fsrsDifficulty: next.difficulty,
    fsrsElapsedDays: next.elapsedDays,
    fsrsScheduledDays: next.scheduledDays,
    fsrsLearningSteps: next.learningSteps,
    fsrsReps: next.reps,
    fsrsLapses: next.lapses,
    fsrsState: next.state,
    fsrsLastReview: next.lastReview,
    scheduleRevision: sql<number>`${schema.problems.scheduleRevision} + 1`,
  };
}

/** Pre-rating state stored in the event's `metadata.undo`. */
export function undoSnapshot(state: FsrsCardState) {
  return {
    due: state.due?.toISOString() ?? null,
    stability: state.stability,
    difficulty: state.difficulty,
    elapsedDays: state.elapsedDays,
    scheduledDays: state.scheduledDays,
    learningSteps: state.learningSteps,
    reps: state.reps,
    lapses: state.lapses,
    state: state.state,
    lastReview: state.lastReview?.toISOString() ?? null,
  };
}

const SCHEDULING_EVENT_TYPES = ["self_recall_rated", "fsrs_scheduled"] as const;

/**
 * Reverts one rating event inside the caller's transaction: restores the
 * pre-rating FSRS state, advances the schedule revision, stamps `undoneAt`,
 * and marks a session's rating undone (it can never be rated again).
 *
 * The event must still account for the current schedule. Every FSRS write
 * advances the revision by one and every Undo by one more, so the schedule is
 * unchanged since the event exactly when the revision equals the event's plus
 * two per later scheduling event that was itself undone. Any other write,
 * even one that keeps the repetition count, is caught. Events from before
 * migration 0021 have no revision and keep the legacy repetition check.
 */
export async function undoRatingEvent(
  tx: DbTransaction,
  userId: string,
  event: ReviewEvent,
  now: Date,
): Promise<{ ok: true } | { ok: false; error: "nothing_to_undo" | "undo_conflict" }> {
  const snapshot = undoSnapshotSchema.safeParse((event.metadata as { undo?: unknown } | null)?.undo);
  if (!snapshot.success || event.undoneAt != null) return { ok: false, error: "nothing_to_undo" };
  const previous = snapshot.data;
  const p = schema.problems;
  const e = schema.reviewEvents;
  let expectedRevision: number | null = null;
  if (event.scheduleRevision != null) {
    const later = await tx
      .select({ undoneAt: e.undoneAt })
      .from(e)
      .where(
        and(
          eq(e.userId, userId),
          eq(e.problemId, event.problemId),
          inArray(e.eventType, [...SCHEDULING_EVENT_TYPES]),
          gt(e.scheduleRevision, event.scheduleRevision),
        ),
      );
    if (later.some((row) => row.undoneAt == null)) return { ok: false, error: "undo_conflict" };
    expectedRevision = event.scheduleRevision + 2 * later.length;
  }
  const [updated] = await tx
    .update(p)
    .set({
      fsrsDue: previous.due ? new Date(previous.due) : null,
      fsrsStability: previous.stability,
      fsrsDifficulty: previous.difficulty,
      fsrsElapsedDays: previous.elapsedDays,
      fsrsScheduledDays: previous.scheduledDays,
      fsrsLearningSteps: previous.learningSteps,
      fsrsReps: previous.reps,
      fsrsLapses: previous.lapses,
      fsrsState: previous.state,
      fsrsLastReview: previous.lastReview ? new Date(previous.lastReview) : null,
      scheduleRevision: sql`${p.scheduleRevision} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(p.id, event.problemId),
        eq(p.userId, userId),
        expectedRevision != null ? eq(p.scheduleRevision, expectedRevision) : eq(p.fsrsReps, previous.reps + 1),
      ),
    )
    .returning({ id: p.id });
  if (!updated) return { ok: false, error: "undo_conflict" };

  await tx
    .update(schema.reviewEvents)
    .set({ undoneAt: now })
    .where(and(eq(schema.reviewEvents.id, event.id), eq(schema.reviewEvents.userId, userId)));
  if (event.practiceSessionId) {
    const s = schema.practiceSessions;
    await tx
      .update(s)
      .set({ ratingDisposition: "undone", revision: sql`${s.revision} + 1`, updatedAt: now })
      .where(and(eq(s.id, event.practiceSessionId), eq(s.userId, userId)));
  }
  return { ok: true };
}

export async function rateProblemReview(
  userId: string,
  input: ReviewRatingInput,
): Promise<RateReviewResult> {
  const db = getDb();
  const now = new Date();
  const requestId = input.requestId ?? crypto.randomUUID();

  const result = await db.transaction(async (tx) => {
    const [problem] = await tx
      .select()
      .from(schema.problems)
      .where(and(eq(schema.problems.id, input.problemId), eq(schema.problems.userId, userId)))
      .limit(1);
    if (!problem) return { ok: false, error: "problem_not_found" } as const;

    const [existingRequest] = await tx
      .select()
      .from(schema.reviewEvents)
      .where(
        and(
          eq(schema.reviewEvents.userId, userId),
          eq(schema.reviewEvents.requestId, requestId),
        ),
      )
      .limit(1);
    if (existingRequest) {
      if (
        existingRequest.problemId !== input.problemId ||
        existingRequest.fsrsRating !== input.rating ||
        existingRequest.undoneAt != null
      ) {
        return { ok: false, error: "review_request_conflict" } as const;
      }
      const storedDue = (existingRequest.metadata as { result?: { nextDue?: unknown } } | null)
        ?.result?.nextDue;
      return {
        ok: true,
        idempotentReplay: true,
        nextDue:
          typeof storedDue === "string"
            ? storedDue
            : problem.fsrsDue?.toISOString() ?? null,
      } as const;
    }
    // Initial learning schedules the first review without a recall rating;
    // rating before that would fabricate one.
    if (problem.enrollment !== "enrolled") return { ok: false, error: "problem_not_enrolled" } as const;

    const state = problemFsrsState(problem);
    const retrievabilityAtReview = retrievability(state);
    const { next } = rate(state, input.rating, now);
    const [updated] = await tx
      .update(schema.problems)
      .set({
        ...fsrsWriteColumns(next),
        updatedAt: now,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      })
      .where(
        and(
          eq(schema.problems.id, input.problemId),
          eq(schema.problems.userId, userId),
          eq(schema.problems.fsrsReps, state.reps),
        ),
      )
      .returning({ id: schema.problems.id, scheduleRevision: schema.problems.scheduleRevision });
    if (!updated) return { ok: false, error: "fsrs_race_conflict" } as const;

    await tx.insert(schema.reviewEvents).values({
      id: nanoid(12),
      userId,
      problemId: input.problemId,
      eventType: "self_recall_rated",
      fsrsRating: input.rating,
      requestId,
      policyVersion: SCHEDULING_POLICIES.legacySelfRecall,
      reviewMethod: "self_recall",
      scheduleRevision: updated.scheduleRevision,
      fsrsStabilitySnap: next.stability,
      fsrsDifficultySnap: next.difficulty,
      fsrsRetrievabilitySnap: retrievabilityAtReview,
      metadata: {
        undo: undoSnapshot(state),
        result: { nextDue: next.due?.toISOString() ?? null },
      },
    });

    return {
      ok: true,
      idempotentReplay: false,
      nextDue: next.due?.toISOString() ?? null,
    } as const;
  });

  if (!result.ok) return result;
  if (!result.idempotentReplay) {
    await markFirstReview(userId).catch((error) => {
      console.warn("[onboarding] failed to record first review", error);
    });
  }
  return { ...result, queue: await getReviewQueueStatus(userId) };
}

export async function undoLatestProblemReview(
  userId: string,
  input: ReviewUndoInput,
): Promise<UndoReviewResult> {
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const [problem] = await tx
      .select({ id: schema.problems.id })
      .from(schema.problems)
      .where(and(eq(schema.problems.id, input.problemId), eq(schema.problems.userId, userId)))
      .limit(1);
    if (!problem) return { ok: false, error: "problem_not_found" } as const;

    const [event] = await tx
      .select()
      .from(schema.reviewEvents)
      .where(
        and(
          eq(schema.reviewEvents.userId, userId),
          eq(schema.reviewEvents.problemId, input.problemId),
          eq(schema.reviewEvents.eventType, "self_recall_rated"),
          isNull(schema.reviewEvents.undoneAt),
        ),
      )
      // Newest by schedule revision; events from before revisions existed last.
      .orderBy(
        asc(sql`${schema.reviewEvents.scheduleRevision} IS NULL`),
        desc(schema.reviewEvents.scheduleRevision),
        desc(schema.reviewEvents.occurredAt),
      )
      .limit(1);
    if (!event) return { ok: false, error: "nothing_to_undo" } as const;
    return undoRatingEvent(tx, userId, event, new Date());
  });

  if (!result.ok) return result;
  return { ok: true, queue: await getReviewQueueStatus(userId) };
}

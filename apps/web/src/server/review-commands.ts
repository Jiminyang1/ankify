import type {
  ReviewRateResponseDto,
  ReviewRatingInput,
  ReviewUndoInput,
  ReviewUndoResponseDto,
} from "@ankify/contracts";
import { rate, retrievability, type FsrsCardState } from "@ankify/core";
import { getDb, schema } from "@ankify/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { markFirstReview } from "./onboarding";
import { getReviewQueueStatus } from "./review-queue";

type RateReviewResult =
  | ReviewRateResponseDto
  | {
      ok: false;
      error: "problem_not_found" | "fsrs_race_conflict" | "review_request_conflict";
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

    const state: FsrsCardState = {
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
    const retrievabilityAtReview = retrievability(state);
    const { next } = rate(state, input.rating, now);
    const [updated] = await tx
      .update(schema.problems)
      .set({
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
      .returning({ id: schema.problems.id });
    if (!updated) return { ok: false, error: "fsrs_race_conflict" } as const;

    await tx.insert(schema.reviewEvents).values({
      id: nanoid(12),
      userId,
      problemId: input.problemId,
      eventType: "self_recall_rated",
      fsrsRating: input.rating,
      requestId,
      fsrsStabilitySnap: next.stability,
      fsrsDifficultySnap: next.difficulty,
      fsrsRetrievabilitySnap: retrievabilityAtReview,
      metadata: {
        undo: {
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
        },
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
      .orderBy(desc(schema.reviewEvents.occurredAt))
      .limit(1);
    const snapshot = undoSnapshotSchema.safeParse(
      (event?.metadata as { undo?: unknown } | null)?.undo,
    );
    if (!event || !snapshot.success) {
      return { ok: false, error: "nothing_to_undo" } as const;
    }

    const previous = snapshot.data;
    const now = new Date();
    const [updated] = await tx
      .update(schema.problems)
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
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.problems.id, input.problemId),
          eq(schema.problems.userId, userId),
          eq(schema.problems.fsrsReps, previous.reps + 1),
        ),
      )
      .returning({ id: schema.problems.id });
    if (!updated) return { ok: false, error: "undo_conflict" } as const;

    await tx
      .update(schema.reviewEvents)
      .set({ undoneAt: now })
      .where(eq(schema.reviewEvents.id, event.id));
    return { ok: true } as const;
  });

  if (!result.ok) return result;
  return { ok: true, queue: await getReviewQueueStatus(userId) };
}

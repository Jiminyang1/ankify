import { NextResponse } from "next/server";
import { getDb, schema } from "@ankify/db";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { rate, retrievability, schemas, type FsrsCardState } from "@ankify/core";
import { getRequestUser, unauthorizedResponse } from "@/lib/auth";
import { getReviewQueueStatus } from "@/lib/review-queue";

export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const body = await req.json().catch(() => null);
  const parsed = schemas.reviewRatingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }
  const { problemId, rating, notes } = parsed.data;
  const requestId = parsed.data.requestId ?? crypto.randomUUID();
  const db = getDb();
  const now = new Date();

  let nextDue: Date | null = null;
  let problemMissing = false;
  let raceConflict = false;
  let requestConflict = false;
  let idempotentReplay = false;

  await db.transaction(async (tx) => {
    const [problem] = await tx
      .select()
      .from(schema.problems)
      .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, user.id)));

    if (!problem) {
      problemMissing = true;
      return;
    }

    const [existingRequest] = await tx
      .select()
      .from(schema.reviewEvents)
      .where(and(eq(schema.reviewEvents.userId, user.id), eq(schema.reviewEvents.requestId, requestId)))
      .limit(1);
    if (existingRequest) {
      if (
        existingRequest.problemId !== problemId ||
        existingRequest.fsrsRating !== rating ||
        existingRequest.undoneAt != null
      ) {
        requestConflict = true;
        return;
      }
      const storedDue = (existingRequest.metadata as { result?: { nextDue?: unknown } } | null)?.result?.nextDue;
      nextDue = typeof storedDue === "string" ? new Date(storedDue) : problem.fsrsDue;
      idempotentReplay = true;
      return;
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

    const retrAtReview = retrievability(state);
    const { next } = rate(state, rating, now);

    const updated = await tx
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
        ...(notes !== undefined ? { notes } : {}),
      })
      .where(
        and(
          eq(schema.problems.id, problemId),
          eq(schema.problems.userId, user.id),
          eq(schema.problems.fsrsReps, state.reps),
        ),
      )
      .returning({ id: schema.problems.id });

    if (updated.length === 0) {
      raceConflict = true;
      return;
    }

    await tx.insert(schema.reviewEvents).values({
      id: nanoid(12),
      userId: user.id,
      problemId,
      eventType: "self_recall_rated",
      fsrsRating: rating,
      requestId,
      fsrsStabilitySnap: next.stability,
      fsrsDifficultySnap: next.difficulty,
      fsrsRetrievabilitySnap: retrAtReview,
      // Pre-rating FSRS snapshot so /api/review/undo can restore the problem.
      metadata: {
        undo: {
          due: state.due ? state.due.toISOString() : null,
          stability: state.stability,
          difficulty: state.difficulty,
          elapsedDays: state.elapsedDays,
          scheduledDays: state.scheduledDays,
          learningSteps: state.learningSteps,
          reps: state.reps,
          lapses: state.lapses,
          state: state.state,
          lastReview: state.lastReview ? state.lastReview.toISOString() : null,
        },
        result: { nextDue: next.due?.toISOString() ?? null },
      },
    });

    nextDue = next.due;
  });

  if (problemMissing) {
    return NextResponse.json({ error: "problem_not_found" }, { status: 404 });
  }
  if (raceConflict) {
    return NextResponse.json({ error: "fsrs_race_conflict" }, { status: 409 });
  }
  if (requestConflict) {
    return NextResponse.json({ error: "review_request_conflict" }, { status: 409 });
  }

  const queue = await getReviewQueueStatus(user.id, db);

  return NextResponse.json({
    ok: true,
    idempotentReplay,
    nextDue,
    queue,
  });
}

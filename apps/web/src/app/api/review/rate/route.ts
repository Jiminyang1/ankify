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
  const db = getDb();
  const now = new Date();

  let nextDue: Date | null = null;

  await db.transaction(async (tx) => {
    const [problem] = await tx
      .select()
      .from(schema.problems)
      .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, user.id)));

    if (!problem) return;

    const state: FsrsCardState = {
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

    const retrAtReview = retrievability(state);
    const { next } = rate(state, rating, now);

    await tx
      .update(schema.problems)
      .set({
        fsrsDue: next.due,
        fsrsStability: next.stability,
        fsrsDifficulty: next.difficulty,
        fsrsElapsedDays: next.elapsedDays,
        fsrsScheduledDays: next.scheduledDays,
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
      );

    await tx.insert(schema.reviewEvents).values({
      id: nanoid(12),
      userId: user.id,
      problemId,
      eventType: "self_recall_rated",
      fsrsRating: rating,
      fsrsStabilitySnap: next.stability,
      fsrsDifficultySnap: next.difficulty,
      fsrsRetrievabilitySnap: retrAtReview,
    });

    nextDue = next.due;
  });

  if (nextDue === null) {
    return NextResponse.json({ error: "problem_not_found" }, { status: 404 });
  }

  const queue = await getReviewQueueStatus(user.id, db);

  return NextResponse.json({
    ok: true,
    nextDue,
    queue,
  });
}

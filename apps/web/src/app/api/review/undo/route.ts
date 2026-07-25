import { NextResponse } from "next/server";
import { getDb, schema } from "@ankify/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { schemas } from "@ankify/core";
import { getRequestUser, unauthorizedResponse } from "@/lib/auth";
import { getReviewQueueStatus } from "@/lib/review-queue";

/** Shape of the pre-rating snapshot written by /api/review/rate. Events from
 *  before the undo feature have no metadata and cannot be undone. */
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

/** POST /api/review/undo — revert the most recent rating of a problem.
 *
 *  Restores the problem's FSRS fields from the snapshot stored on the rated
 *  event and marks the event undone. The log remains append-only while
 *  dashboards and done-today counts exclude voided ratings. */
export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const body = await req.json().catch(() => null);
  const parsed = schemas.reviewUndoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }
  const { problemId } = parsed.data;
  const db = getDb();

  let failure: "problem_not_found" | "nothing_to_undo" | "undo_conflict" | null = null;

  await db.transaction(async (tx) => {
    const [problem] = await tx
      .select()
      .from(schema.problems)
      .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, user.id)));
    if (!problem) {
      failure = "problem_not_found";
      return;
    }

    const [event] = await tx
      .select()
      .from(schema.reviewEvents)
      .where(
        and(
          eq(schema.reviewEvents.userId, user.id),
          eq(schema.reviewEvents.problemId, problemId),
          eq(schema.reviewEvents.eventType, "self_recall_rated"),
          isNull(schema.reviewEvents.undoneAt),
        ),
      )
      .orderBy(desc(schema.reviewEvents.occurredAt))
      .limit(1);

    const snapshot = undoSnapshotSchema.safeParse((event?.metadata as { undo?: unknown } | null)?.undo);
    if (!event || !snapshot.success) {
      failure = "nothing_to_undo";
      return;
    }
    const prev = snapshot.data;

    // Rating always increments reps by exactly one; anything else means the
    // problem was rated again elsewhere and this event is stale.
    const updated = await tx
      .update(schema.problems)
      .set({
        fsrsDue: prev.due ? new Date(prev.due) : null,
        fsrsStability: prev.stability,
        fsrsDifficulty: prev.difficulty,
        fsrsElapsedDays: prev.elapsedDays,
        fsrsScheduledDays: prev.scheduledDays,
        fsrsLearningSteps: prev.learningSteps,
        fsrsReps: prev.reps,
        fsrsLapses: prev.lapses,
        fsrsState: prev.state,
        fsrsLastReview: prev.lastReview ? new Date(prev.lastReview) : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.problems.id, problemId),
          eq(schema.problems.userId, user.id),
          eq(schema.problems.fsrsReps, prev.reps + 1),
        ),
      )
      .returning({ id: schema.problems.id });

    if (updated.length === 0) {
      failure = "undo_conflict";
      return;
    }

    await tx
      .update(schema.reviewEvents)
      .set({ undoneAt: new Date() })
      .where(eq(schema.reviewEvents.id, event.id));
  });

  if (failure === "problem_not_found") {
    return NextResponse.json({ error: failure }, { status: 404 });
  }
  if (failure) {
    return NextResponse.json({ error: failure }, { status: 409 });
  }

  const queue = await getReviewQueueStatus(user.id);
  return NextResponse.json({ ok: true, queue });
}

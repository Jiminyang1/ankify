import { NextResponse } from "next/server";
import { getDb, schema } from "@ankify/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { preview, type FsrsCardState } from "@ankify/core";
import { getRequestUser, unauthorizedResponse } from "@/lib/auth";
import { dueProblemCondition } from "@/lib/due-problems";
import { getReviewQueueStatus } from "@/lib/review-queue";

/** Returns the next due problem with FSRS scheduling previews for each rating. */
export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const db = getDb();
  const now = new Date();
  const queue = await getReviewQueueStatus(user.id, db);

  const problem =
    queue.remaining > 0
      ? (
          await db
            .select()
            .from(schema.problems)
            .where(dueProblemCondition(user.id, now))
            .orderBy(asc(sql`COALESCE(${schema.problems.fsrsDue}, 0)`))
            .limit(1)
        )[0] ?? null
      : null;

  if (!problem) {
    return NextResponse.json({ problem: null, previews: null, queue });
  }

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

  const previews = preview(state, now);

  // Probe pool: only user-approved saved cards.
  const cards = await db
    .select()
    .from(schema.cards)
    .where(and(eq(schema.cards.userId, user.id), eq(schema.cards.problemId, problem.id), eq(schema.cards.aiStatus, "ready")));
  const submissions = await db
    .select()
    .from(schema.submissions)
    .where(and(eq(schema.submissions.userId, user.id), eq(schema.submissions.problemId, problem.id)))
    .orderBy(desc(schema.submissions.submittedAt))
    .limit(10);

  return NextResponse.json({
    problem: { ...problem, cards, submissions },
    previews,
    queue,
  });
}

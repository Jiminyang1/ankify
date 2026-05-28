import { NextResponse } from "next/server";
import { getDb, schema } from "@ankify/db";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { preview, type FsrsCardState } from "@ankify/core";
import { getRequestUser, unauthorizedResponse } from "@/lib/auth";
import { dueProblemCondition } from "@/lib/due-problems";
import { getReviewQueueStatus } from "@/lib/review-queue";

/**
 * Returns a problem to review with FSRS scheduling previews for each rating.
 *
 * Default: the earliest-due problem, gated by the daily review limit.
 * `?problemId=<id>`: that specific problem, reviewed ahead of schedule —
 * bypasses both the due condition and the daily limit. FSRS still schedules
 * correctly because `rate()` recomputes elapsed time from `lastReview`.
 */
export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const db = getDb();
  const now = new Date();
  const targetId = new URL(req.url).searchParams.get("problemId");

  const [queue, problemRows] = await Promise.all([
    getReviewQueueStatus(user.id, db),
    targetId
      ? db
          .select()
          .from(schema.problems)
          .where(
            and(
              eq(schema.problems.id, targetId),
              eq(schema.problems.userId, user.id),
              isNull(schema.problems.archivedAt),
            ),
          )
          .limit(1)
      : db
          .select()
          .from(schema.problems)
          .where(dueProblemCondition(user.id, now))
          .orderBy(asc(sql`COALESCE(${schema.problems.fsrsDue}, 0)`))
          .limit(1),
  ]);

  // Targeted review ignores the daily-limit gate; queue review respects it.
  const problem = targetId ? problemRows[0] ?? null : queue.remaining > 0 ? problemRows[0] ?? null : null;

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
  const [cards, submissions] = await Promise.all([
    db
      .select()
      .from(schema.cards)
      .where(and(eq(schema.cards.userId, user.id), eq(schema.cards.problemId, problem.id), eq(schema.cards.aiStatus, "ready"))),
    db
      .select()
      .from(schema.submissions)
      .where(and(eq(schema.submissions.userId, user.id), eq(schema.submissions.problemId, problem.id)))
      .orderBy(desc(schema.submissions.submittedAt))
      .limit(10),
  ]);

  return NextResponse.json({
    problem: { ...problem, cards, submissions },
    previews,
    queue,
  });
}

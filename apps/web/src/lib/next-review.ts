import { getDb, schema } from "@ankify/db";
import type { Card, Problem, Submission } from "@ankify/db";
import { preview, type FsrsCardState, type FsrsRating } from "@ankify/core";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { dueProblemCondition } from "./due-problems";
import { getReviewQueueStatus } from "./review-queue";

export type ReviewPayload = {
  problem: (Problem & { cards: Card[]; submissions: Submission[] }) | null;
  previews: Record<FsrsRating, { due: string }> | null;
  queue: Awaited<ReturnType<typeof getReviewQueueStatus>>;
};

export async function loadNextReview(
  userId: string,
  targetId?: string | null,
): Promise<ReviewPayload> {
  const db = getDb();
  const now = new Date();

  const [queue, problemRows] = await Promise.all([
    getReviewQueueStatus(userId),
    targetId
      ? db
          .select()
          .from(schema.problems)
          .where(
            and(
              eq(schema.problems.id, targetId),
              eq(schema.problems.userId, userId),
              isNull(schema.problems.archivedAt),
            ),
          )
          .limit(1)
      : db
          .select()
          .from(schema.problems)
          .where(dueProblemCondition(userId, now))
          .orderBy(asc(sql`COALESCE(${schema.problems.fsrsDue}, 0)`))
          .limit(1),
  ]);

  const problem = targetId
    ? problemRows[0] ?? null
    : queue.remaining > 0
      ? problemRows[0] ?? null
      : null;

  if (!problem) {
    return { problem: null, previews: null, queue };
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

  const previews = preview(state, now);
  const [cards, submissions] = await Promise.all([
    db
      .select()
      .from(schema.cards)
      .where(
        and(
          eq(schema.cards.userId, userId),
          eq(schema.cards.problemId, problem.id),
          eq(schema.cards.aiStatus, "ready"),
        ),
      )
      .orderBy(desc(schema.cards.createdAt))
      .limit(50),
    db
      .select()
      .from(schema.submissions)
      .where(
        and(
          eq(schema.submissions.userId, userId),
          eq(schema.submissions.problemId, problem.id),
        ),
      )
      .orderBy(desc(schema.submissions.submittedAt))
      .limit(10),
  ]);

  return {
    problem: { ...problem, cards, submissions },
    previews,
    queue,
  };
}

import { getDb, schema } from "@ankify/db";
import type { ReviewPayloadDto, ReviewProblemDto } from "@ankify/contracts";
import { preview, type FsrsCardState } from "@ankify/core";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { dueProblemCondition } from "./due-problems";
import { getReviewQueueStatus } from "./review-queue";

const reviewProblemColumns = {
  id: schema.problems.id,
  leetcodeId: schema.problems.leetcodeId,
  title: schema.problems.title,
  difficulty: schema.problems.difficulty,
  descriptionMd: schema.problems.descriptionMd,
  topicTags: schema.problems.topicTags,
  fsrsDue: schema.problems.fsrsDue,
  fsrsStability: schema.problems.fsrsStability,
  fsrsDifficulty: schema.problems.fsrsDifficulty,
  fsrsElapsedDays: schema.problems.fsrsElapsedDays,
  fsrsScheduledDays: schema.problems.fsrsScheduledDays,
  fsrsLearningSteps: schema.problems.fsrsLearningSteps,
  fsrsReps: schema.problems.fsrsReps,
  fsrsLapses: schema.problems.fsrsLapses,
  fsrsState: schema.problems.fsrsState,
  fsrsLastReview: schema.problems.fsrsLastReview,
};

export async function loadNextReview(
  userId: string,
  targetId?: string | null,
): Promise<ReviewPayloadDto> {
  const db = getDb();
  const now = new Date();

  const [queue, problemRows] = await Promise.all([
    getReviewQueueStatus(userId),
    targetId
      ? db
          .select(reviewProblemColumns)
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
          .select(reviewProblemColumns)
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
    return { problem: null, previews: null, previewedAt: now.toISOString(), queue };
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
  const reviewProblem: ReviewProblemDto = {
    ...problem,
    fsrsDue: problem.fsrsDue?.toISOString() ?? null,
    fsrsLastReview: problem.fsrsLastReview?.toISOString() ?? null,
  };
  return {
    problem: reviewProblem,
    previews,
    previewedAt: now.toISOString(),
    queue,
  };
}

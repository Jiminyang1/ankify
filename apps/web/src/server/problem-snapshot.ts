import type { ProblemDto, ProblemLookupPayloadDto } from "@ankify/contracts";
import { preview, type FsrsCardState } from "@ankify/core";
import { getDb, schema } from "@ankify/db";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { getReviewQueueStatus } from "@/server/review-queue";
import { publicCardColumns } from "./public-dto";

const problemColumns = {
  id: schema.problems.id,
  leetcodeSlug: schema.problems.leetcodeSlug,
  leetcodeId: schema.problems.leetcodeId,
  title: schema.problems.title,
  difficulty: schema.problems.difficulty,
  notes: schema.problems.notes,
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
} as const;

export async function loadProblemSnapshotBySlug(
  userId: string,
  slug: string,
): Promise<ProblemLookupPayloadDto | null> {
  const db = getDb();
  const [problem] = await db
    .select(problemColumns)
    .from(schema.problems)
    .where(
      and(
        eq(schema.problems.userId, userId),
        eq(schema.problems.leetcodeSlug, slug),
        isNull(schema.problems.archivedAt),
      ),
    )
    .limit(1);
  if (!problem) return null;

  const [cards, candidates, queue] = await Promise.all([
    db
      .select(publicCardColumns)
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
      .select(publicCardColumns)
      .from(schema.cards)
      .where(
        and(
          eq(schema.cards.userId, userId),
          eq(schema.cards.problemId, problem.id),
          ne(schema.cards.aiStatus, "ready"),
        ),
      )
      .orderBy(desc(schema.cards.createdAt))
      .limit(25),
    getReviewQueueStatus(userId),
  ]);

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
  const problemDto: ProblemDto = {
    id: problem.id,
    leetcodeSlug: problem.leetcodeSlug,
    leetcodeId: problem.leetcodeId,
    title: problem.title,
    difficulty: problem.difficulty,
    fsrsState: problem.fsrsState,
    fsrsDue: problem.fsrsDue?.toISOString() ?? null,
    fsrsReps: problem.fsrsReps,
    fsrsLapses: problem.fsrsLapses,
    fsrsStability: problem.fsrsStability,
    notes: problem.notes,
  };
  return {
    problem: problemDto,
    cards,
    candidates,
    previews: preview(state, new Date()),
    queue,
  };
}

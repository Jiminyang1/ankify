import type { ReviewQueuePayloadDto } from "@ankify/contracts";
import { getDb, schema } from "@ankify/db";
import { asc, sql } from "drizzle-orm";
import { dueProblemCondition } from "@/server/due-problems";
import { countDocCards } from "@/server/problem-docs";
import { getReviewQueueStatus } from "@/server/review-queue";

export async function loadReviewQueueData(
  userId: string,
  cap: number,
): Promise<ReviewQueuePayloadDto> {
  const db = getDb();
  const queue = await getReviewQueueStatus(userId);
  const limit = Math.min(cap, queue.remaining);

  if (limit <= 0) {
    return { queue, problems: [] };
  }

  const dueProblems = await db
    .select({
      id: schema.problems.id,
      leetcodeSlug: schema.problems.leetcodeSlug,
      title: schema.problems.title,
      difficulty: schema.problems.difficulty,
      url: schema.problems.url,
      fsrsState: schema.problems.fsrsState,
      fsrsDue: schema.problems.fsrsDue,
      fsrsStability: schema.problems.fsrsStability,
      fsrsReps: schema.problems.fsrsReps,
      fsrsLapses: schema.problems.fsrsLapses,
    })
    .from(schema.problems)
    .where(dueProblemCondition(userId, new Date()))
    .orderBy(asc(sql`COALESCE(${schema.problems.fsrsDue}, 0)`))
    .limit(limit);

  // Legacy: extension builds from before the Cards doc moved into Notes
  // (0.3.x) still show a card count on Today.
  const problemIds = dueProblems.map((problem) => problem.id);
  const cardCountByProblem = await countDocCards(userId, problemIds);

  return {
    queue,
    problems: dueProblems.map((problem) => ({
      ...problem,
      fsrsDue: problem.fsrsDue?.toISOString() ?? null,
      cardCount: cardCountByProblem.get(problem.id) ?? 0,
    })),
  };
}

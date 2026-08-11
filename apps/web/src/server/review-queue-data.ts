import type { ReviewQueuePayloadDto } from "@ankify/contracts";
import { getDb, schema } from "@ankify/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { dueProblemCondition } from "@/server/due-problems";
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

  const problemIds = dueProblems.map((problem) => problem.id);
  const cardCounts = problemIds.length
    ? await db
        .select({
          problemId: schema.cards.problemId,
          total: sql<number>`count(*)`,
        })
        .from(schema.cards)
        .where(
          and(
            eq(schema.cards.userId, userId),
            eq(schema.cards.aiStatus, "ready"),
            inArray(schema.cards.problemId, problemIds),
          ),
        )
        .groupBy(schema.cards.problemId)
    : [];

  const cardCountByProblem = new Map(
    cardCounts.map((row) => [row.problemId, row.total]),
  );

  return {
    queue,
    problems: dueProblems.map((problem) => ({
      ...problem,
      fsrsDue: problem.fsrsDue?.toISOString() ?? null,
      cardCount: cardCountByProblem.get(problem.id) ?? 0,
    })),
  };
}

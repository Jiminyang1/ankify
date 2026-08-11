import { getDb, schema } from "@ankify/db";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { dueProblemCondition } from "@/server/due-problems";
import { getReviewQueueStatus } from "@/server/review-queue";

export async function loadToday(userId: string) {
  try {
    const db = getDb();
    const now = new Date();
    const [queue, totalRows, allDueProblems] = await Promise.all([
      getReviewQueueStatus(userId),
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.problems)
        .where(and(eq(schema.problems.userId, userId), isNull(schema.problems.archivedAt))),
      db
        .select()
        .from(schema.problems)
        .where(dueProblemCondition(userId, now))
        .orderBy(asc(sql`COALESCE(${schema.problems.fsrsDue}, 0)`), desc(schema.problems.createdAt))
        .limit(8),
    ]);

    const dueProblems = allDueProblems.slice(0, Math.min(8, queue.remaining));
    const dueProblemIds = dueProblems.map((problem) => problem.id);
    const cardStats = dueProblemIds.length
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
              inArray(schema.cards.problemId, dueProblemIds),
            ),
          )
          .groupBy(schema.cards.problemId)
      : [];

    return {
      totalProblems: totalRows[0]?.count ?? 0,
      dueCount: queue.dueCount,
      totalDue: queue.totalDue,
      doneToday: queue.doneToday,
      dailyReviewLimit: queue.dailyReviewLimit,
      dueProblems,
      cardsByProblem: new Map(cardStats.map((row) => [row.problemId, row.total ?? 0])),
    };
  } catch {
    return {
      totalProblems: 0,
      dueCount: 0,
      totalDue: 0,
      doneToday: 0,
      dailyReviewLimit: 20,
      dueProblems: [],
      cardsByProblem: new Map<string, number>(),
      error: true,
    } as const;
  }
}

import { getDb, schema, type DB } from "@ankify/db";
import { and, eq, sql } from "drizzle-orm";
import { dueProblemCondition } from "./due-problems";
import { getReviewSettings } from "./settings";

export async function getReviewQueueStatus(userId: string, db: DB = getDb()) {
  const now = new Date();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const review = await getReviewSettings(userId);

  const [totalDueRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.problems)
    .where(dueProblemCondition(userId, now));

  const [doneTodayRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.reviewEvents)
    .where(
      and(
        eq(schema.reviewEvents.userId, userId),
        eq(schema.reviewEvents.eventType, "self_recall_rated"),
        sql`${schema.reviewEvents.occurredAt} >= ${startOfDay}`,
      ),
    );

  const totalDue = totalDueRow?.count ?? 0;
  const doneToday = doneTodayRow?.count ?? 0;
  const remaining = Math.max(0, review.dailyReviewLimit - doneToday);

  return {
    dailyReviewLimit: review.dailyReviewLimit,
    doneToday,
    remaining,
    totalDue,
    dueCount: Math.min(totalDue, remaining),
  };
}

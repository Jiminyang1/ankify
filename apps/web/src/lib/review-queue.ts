import { getDb, schema, type DB } from "@ankify/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { dueProblemCondition } from "./due-problems";
import { getReviewSettings } from "./settings";
import { getZonedDayBounds } from "./time-zone";

export async function getReviewQueueStatus(userId: string, db: DB = getDb()) {
  const now = new Date();
  const review = await getReviewSettings(userId);
  const { start: startOfDay } = getZonedDayBounds(review.timeZone, now);

  const [totalDueRows, doneTodayRows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(schema.problems)
      .where(dueProblemCondition(userId, now)),
    db
      .select({ count: sql<number>`count(*)` })
      .from(schema.reviewEvents)
      .where(
        and(
          eq(schema.reviewEvents.userId, userId),
          eq(schema.reviewEvents.eventType, "self_recall_rated"),
          isNull(schema.reviewEvents.undoneAt),
          sql`${schema.reviewEvents.occurredAt} >= ${startOfDay}`,
        ),
      ),
  ]);

  const totalDue = totalDueRows[0]?.count ?? 0;
  const doneToday = doneTodayRows[0]?.count ?? 0;
  const remaining = Math.max(0, review.dailyReviewLimit - doneToday);

  return {
    dailyReviewLimit: review.dailyReviewLimit,
    doneToday,
    remaining,
    totalDue,
    dueCount: Math.min(totalDue, remaining),
  };
}

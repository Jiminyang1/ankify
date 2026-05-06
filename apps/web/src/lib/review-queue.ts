import { getDb, schema, type DB } from "@ankify/db";
import { and, sql } from "drizzle-orm";
import { dueProblemCondition } from "./due-problems";
import { getReviewSettings } from "./settings";

export async function getReviewQueueStatus(db: DB = getDb()) {
  const now = new Date();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const review = await getReviewSettings();

  const [totalDueRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.problems)
    .where(dueProblemCondition(now));

  const [doneTodayRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.reviewEvents)
    .where(
      and(
        sql`${schema.reviewEvents.eventType} = 'self_recall_rated'`,
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

import { getDb, schema } from "@ankify/db";
import type { QueueStatsDto } from "@ankify/contracts";
import { and, eq, isNull, sql } from "drizzle-orm";
import { cache } from "react";
import { dueProblemCondition } from "./due-problems";
import { getReviewSettings } from "./settings";
import { getZonedDayBounds } from "./time-zone";

/**
 * Queue stats for the current review day. Memoized per request so the app
 * layout (nav badge) and the page loader below it share one execution instead
 * of each paying the settings read plus two counts.
 */
export const getReviewQueueStatus = cache(async (userId: string): Promise<QueueStatsDto> => {
  const db = getDb();
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
});

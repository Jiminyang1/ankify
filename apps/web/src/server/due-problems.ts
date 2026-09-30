import { schema } from "@ankify/db";
import { and, eq, isNull, lte, or } from "drizzle-orm";

/** Due for review: enrolled (initial learning complete), not archived, and
 *  scheduled at or before `now` (or never scheduled, for legacy captures). */
export function dueProblemCondition(userId: string, now = new Date()) {
  return and(
    eq(schema.problems.userId, userId),
    isNull(schema.problems.archivedAt),
    eq(schema.problems.enrollment, "enrolled"),
    or(isNull(schema.problems.fsrsDue), lte(schema.problems.fsrsDue, now)),
  );
}

import { schema } from "@ankify/db";
import { and, eq, isNull, lte, or } from "drizzle-orm";

export function dueProblemCondition(userId: string, now = new Date()) {
  return and(
    eq(schema.problems.userId, userId),
    isNull(schema.problems.archivedAt),
    or(isNull(schema.problems.fsrsDue), lte(schema.problems.fsrsDue, now)),
  );
}

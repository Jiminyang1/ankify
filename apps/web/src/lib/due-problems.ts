import { schema } from "@ankify/db";
import { and, isNull, lte, or } from "drizzle-orm";

export function dueProblemCondition(now = new Date()) {
  return and(
    isNull(schema.problems.archivedAt),
    or(isNull(schema.problems.fsrsDue), lte(schema.problems.fsrsDue, now)),
  );
}

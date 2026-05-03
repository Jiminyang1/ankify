import { schema } from "@ankify/db";
import { and, isNull, lte, or, sql } from "drizzle-orm";

export function hasReadyCardsCondition() {
  return sql`EXISTS (
    SELECT 1 FROM ${schema.cards}
    WHERE ${schema.cards.problemId} = ${schema.problems.id}
      AND ${schema.cards.aiStatus} = 'ready'
  )`;
}

export function dueProblemCondition(now = new Date()) {
  return and(
    isNull(schema.problems.archivedAt),
    or(isNull(schema.problems.fsrsDue), lte(schema.problems.fsrsDue, now)),
    hasReadyCardsCondition(),
  );
}

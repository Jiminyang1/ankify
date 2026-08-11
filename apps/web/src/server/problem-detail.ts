import { getDb, schema } from "@ankify/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  publicCardColumns,
  publicSubmissionColumns,
  toSubmissionDto,
} from "./public-dto";

export async function loadProblemDetail(userId: string, problemId: string) {
  const db = getDb();
  const [problem] = await db
    .select()
    .from(schema.problems)
    .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, userId)))
    .limit(1);
  if (!problem) return null;

  const [submissions, cards, reviewHistory] = await Promise.all([
    db
      .select(publicSubmissionColumns)
      .from(schema.submissions)
      .where(and(eq(schema.submissions.userId, userId), eq(schema.submissions.problemId, problemId)))
      .orderBy(desc(schema.submissions.submittedAt))
      .limit(10),
    db
      .select(publicCardColumns)
      .from(schema.cards)
      .where(
        and(
          eq(schema.cards.userId, userId),
          eq(schema.cards.problemId, problemId),
          eq(schema.cards.aiStatus, "ready"),
        ),
      )
      .orderBy(desc(schema.cards.createdAt))
      .limit(50),
    db
      .select()
      .from(schema.reviewEvents)
      .where(
        and(
          eq(schema.reviewEvents.userId, userId),
          eq(schema.reviewEvents.problemId, problemId),
          eq(schema.reviewEvents.eventType, "self_recall_rated"),
          isNull(schema.reviewEvents.undoneAt),
        ),
      )
      .orderBy(desc(schema.reviewEvents.occurredAt))
      .limit(20),
  ]);

  return {
    problem,
    submissions: submissions.map(toSubmissionDto),
    cards,
    reviewHistory,
  };
}

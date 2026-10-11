import { getDb, schema } from "@ankify/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { loadProblemDocs } from "./problem-docs";
import { publicSubmissionColumns, toSubmissionDto } from "./public-dto";
import { listProblemWeaknesses } from "./weaknesses";

export async function loadProblemDetail(userId: string, problemId: string) {
  const db = getDb();
  const [problem] = await db
    .select()
    .from(schema.problems)
    .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, userId)))
    .limit(1);
  if (!problem) return null;

  const [submissions, docs, weaknesses, reviewHistory] = await Promise.all([
    db
      .select(publicSubmissionColumns)
      .from(schema.submissions)
      .where(and(eq(schema.submissions.userId, userId), eq(schema.submissions.problemId, problemId)))
      .orderBy(desc(schema.submissions.submittedAt))
      .limit(10),
    loadProblemDocs(userId, problemId),
    listProblemWeaknesses(userId, problemId),
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
    docs: docs!,
    weaknesses,
    reviewHistory,
  };
}

import { getDb, schema } from "@ankify/db";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { listProblemMistakes } from "./mistakes";
import { listPracticeSessions } from "./practice-sessions/queries";
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

  const [submissions, cards, reviewHistory, mistakes] = await Promise.all([
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
    // The scheduling timeline: ratings (not undone) and initial-review schedules.
    db
      .select()
      .from(schema.reviewEvents)
      .where(
        and(
          eq(schema.reviewEvents.userId, userId),
          eq(schema.reviewEvents.problemId, problemId),
          or(
            and(eq(schema.reviewEvents.eventType, "self_recall_rated"), isNull(schema.reviewEvents.undoneAt)),
            eq(schema.reviewEvents.eventType, "fsrs_scheduled"),
          ),
        ),
      )
      .orderBy(desc(schema.reviewEvents.occurredAt))
      .limit(30),
    listProblemMistakes(userId, problemId),
  ]);
  const { sessions } = await listPracticeSessions(userId, { problemId, limit: 20 });
  const improvements = sessions.length
    ? await db
        .select({ id: schema.practiceImprovements.id, practiceSessionId: schema.practiceImprovements.practiceSessionId, category: schema.practiceImprovements.category })
        .from(schema.practiceImprovements)
        .where(
          and(
            eq(schema.practiceImprovements.userId, userId),
            eq(schema.practiceImprovements.problemId, problemId),
            inArray(schema.practiceImprovements.practiceSessionId, sessions.map((session) => session.id)),
          ),
        )
    : [];

  return {
    problem,
    submissions: submissions.map(toSubmissionDto),
    cards,
    timeline: reviewHistory.map((event) => ({
      id: event.id,
      kind: event.eventType === "fsrs_scheduled" ? ("scheduled" as const) : ("rated" as const),
      rating: event.fsrsRating,
      method: event.reviewMethod,
      practiceSessionId: event.practiceSessionId,
      occurredAt: event.occurredAt,
      nextDue: timelineDue(event.metadata),
      stability: event.fsrsStabilitySnap,
      difficulty: event.fsrsDifficultySnap,
    })),
    sessions,
    improvements,
    mistakes,
  };
}

/** The due date an event set: a rating's next review or the first review. */
function timelineDue(metadata: Record<string, unknown> | null): string | null {
  const meta = metadata as { result?: { nextDue?: unknown }; initialReview?: { due?: unknown } } | null;
  const due = meta?.result?.nextDue ?? meta?.initialReview?.due;
  return typeof due === "string" ? due : null;
}

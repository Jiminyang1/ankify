import type { QuizAnswer, QuizItem, QuizSessionDto } from "@ankify/contracts";
import { getDb, schema } from "@ankify/db";
import { and, eq, sql } from "drizzle-orm";
import { toQuizSessionDto } from "./public-dto";

const quizSessionColumns = {
  id: schema.quizSessions.id,
  problemId: schema.quizSessions.problemId,
  status: schema.quizSessions.status,
  itemsJson: schema.quizSessions.itemsJson,
  answersJson: schema.quizSessions.answersJson,
  score: schema.quizSessions.score,
  createdAt: schema.quizSessions.createdAt,
  updatedAt: schema.quizSessions.updatedAt,
  completedAt: schema.quizSessions.completedAt,
} as const;

type AnswerQuizResult =
  | {
      ok: true;
      answer: QuizAnswer;
      item: QuizItem;
      completed: boolean;
      session: QuizSessionDto;
    }
  | {
      ok: false;
      error:
        | "quiz_session_not_found"
        | "quiz_session_not_active"
        | "quiz_item_not_found"
        | "quiz_item_already_answered"
        | "quiz_answer_conflict";
    };

export async function answerQuizItem(
  userId: string,
  problemId: string,
  sessionId: string,
  input: Pick<QuizAnswer, "itemId" | "selectedIndex">,
): Promise<AnswerQuizResult> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(schema.quizSessions)
      .where(
        and(
          eq(schema.quizSessions.id, sessionId),
          eq(schema.quizSessions.userId, userId),
          eq(schema.quizSessions.problemId, problemId),
        ),
      )
      .limit(1);

    if (!session || session.status === "archived") {
      return { ok: false, error: "quiz_session_not_found" };
    }
    if (session.status !== "active") {
      return { ok: false, error: "quiz_session_not_active" };
    }

    const item = session.itemsJson.find((quizItem) => quizItem.id === input.itemId);
    if (!item) return { ok: false, error: "quiz_item_not_found" };
    if (session.answersJson.some((answer) => answer.itemId === item.id)) {
      return { ok: false, error: "quiz_item_already_answered" };
    }

    const now = new Date();
    const answer: QuizAnswer = {
      itemId: item.id,
      selectedIndex: input.selectedIndex,
      correct: input.selectedIndex === item.answerIndex,
      answeredAt: now.toISOString(),
    };
    const expectedLength = session.answersJson.length;
    const answers = [...session.answersJson, answer];
    const completed = answers.length === session.itemsJson.length;
    const [updated] = await tx
      .update(schema.quizSessions)
      .set({
        answersJson: answers,
        status: completed ? "completed" : "active",
        score: completed ? answers.filter((candidate) => candidate.correct).length : null,
        updatedAt: now,
        completedAt: completed ? now : null,
      })
      .where(
        and(
          eq(schema.quizSessions.id, sessionId),
          eq(schema.quizSessions.userId, userId),
          eq(schema.quizSessions.problemId, problemId),
          eq(schema.quizSessions.status, "active"),
          sql`json_array_length(${schema.quizSessions.answersJson}) = ${expectedLength}`,
        ),
      )
      .returning(quizSessionColumns);

    if (!updated) return { ok: false, error: "quiz_answer_conflict" };

    return {
      ok: true,
      answer,
      item,
      completed,
      session: toQuizSessionDto(updated),
    };
  });
}

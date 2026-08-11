import type { CardDto } from "@ankify/contracts";
import { getDb, schema } from "@ankify/db";
import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { MAX_CARDS_PER_PROBLEM } from "@/server/resource-limits";
import { publicCardColumns } from "./public-dto";

type UpdateOwnedCardInput = {
  expectedVersion: number;
  aiStatus?: "ready";
  question?: string;
  answer?: string;
};

type UpdateOwnedCardResult =
  | { ok: true; card: CardDto }
  | { ok: false; error: "not_found" | "card_version_conflict" };

type CreateManualCardResult =
  | { ok: true; cardId: string }
  | { ok: false; error: "problem_not_found" }
  | { ok: false; error: "card_limit_reached"; limit: number };

type SaveQuizItemAsCardResult =
  | { ok: true; card: CardDto }
  | {
      ok: false;
      error:
        | "quiz_session_not_found"
        | "quiz_item_not_found"
        | "card_id_collision";
    }
  | { ok: false; error: "card_limit_reached"; limit: number };

export async function updateOwnedCard(
  userId: string,
  cardId: string,
  input: UpdateOwnedCardInput,
): Promise<UpdateOwnedCardResult> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [card] = await tx
      .select({
        id: schema.cards.id,
        problemId: schema.cards.problemId,
        aiStatus: schema.cards.aiStatus,
      })
      .from(schema.cards)
      .where(and(eq(schema.cards.id, cardId), eq(schema.cards.userId, userId)))
      .limit(1);
    if (!card) return { ok: false, error: "not_found" };

    const shouldFireEvent = input.aiStatus === "ready" && card.aiStatus !== "ready";
    const { expectedVersion, ...patch } = input;
    const [updated] = await tx
      .update(schema.cards)
      .set({
        ...patch,
        version: sql`${schema.cards.version} + 1`,
        updatedAt: new Date(),
        ...(patch.aiStatus === "ready" ? { errorMessage: null } : {}),
      })
      .where(
        and(
          eq(schema.cards.id, cardId),
          eq(schema.cards.userId, userId),
          eq(schema.cards.version, expectedVersion),
        ),
      )
      .returning(publicCardColumns);
    if (!updated) return { ok: false, error: "card_version_conflict" };

    if (shouldFireEvent) {
      await tx.insert(schema.reviewEvents).values({
        id: nanoid(12),
        userId,
        problemId: card.problemId,
        cardId: card.id,
        eventType: "card_created",
        metadata: { source: "ai" },
      });
    }

    return { ok: true, card: updated };
  });
}

export async function createManualCard(
  userId: string,
  problemId: string,
  input: { question: string; answer: string },
): Promise<CreateManualCardResult> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [problem] = await tx
      .select({ id: schema.problems.id })
      .from(schema.problems)
      .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, userId)))
      .limit(1);
    if (!problem) return { ok: false, error: "problem_not_found" };

    const [{ count } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(schema.cards)
      .where(and(eq(schema.cards.userId, userId), eq(schema.cards.problemId, problemId)));
    if (count >= MAX_CARDS_PER_PROBLEM) {
      return { ok: false, error: "card_limit_reached", limit: MAX_CARDS_PER_PROBLEM };
    }

    const cardId = nanoid(12);
    await tx.insert(schema.cards).values({
      id: cardId,
      userId,
      problemId,
      aiStatus: "ready",
      question: input.question,
      answer: input.answer,
    });
    await tx.insert(schema.reviewEvents).values({
      id: nanoid(12),
      userId,
      problemId,
      cardId,
      eventType: "card_created",
      metadata: { source: "manual" },
    });

    return { ok: true, cardId };
  });
}

export async function saveQuizItemAsCard(
  userId: string,
  problemId: string,
  sessionId: string,
  itemId: string,
): Promise<SaveQuizItemAsCardResult> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select({
        id: schema.quizSessions.id,
        status: schema.quizSessions.status,
        itemsJson: schema.quizSessions.itemsJson,
      })
      .from(schema.quizSessions)
      .where(
        and(
          eq(schema.quizSessions.userId, userId),
          eq(schema.quizSessions.id, sessionId),
          eq(schema.quizSessions.problemId, problemId),
        ),
      )
      .limit(1);
    if (!session || session.status === "archived") {
      return { ok: false, error: "quiz_session_not_found" };
    }

    const item = session.itemsJson.find((quizItem) => quizItem.id === itemId);
    if (!item) return { ok: false, error: "quiz_item_not_found" };

    const cardId = `qz_${session.id}_${item.id}`;
    const [existingCard] = await tx
      .select(publicCardColumns)
      .from(schema.cards)
      .where(and(eq(schema.cards.id, cardId), eq(schema.cards.userId, userId)))
      .limit(1);
    if (existingCard) return { ok: true, card: existingCard };

    const [{ count } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(schema.cards)
      .where(and(eq(schema.cards.userId, userId), eq(schema.cards.problemId, problemId)));
    if (count >= MAX_CARDS_PER_PROBLEM) {
      return { ok: false, error: "card_limit_reached", limit: MAX_CARDS_PER_PROBLEM };
    }

    const correctChoice = item.choices[item.answerIndex] ?? "";
    const answer = [`**Correct answer:** ${correctChoice}`, item.explanation].filter(Boolean).join("\n\n");
    const [inserted] = await tx
      .insert(schema.cards)
      .values({
        id: cardId,
        userId,
        problemId,
        aiStatus: "ready",
        errorMessage: null,
        question: item.question,
        answer,
      })
      .onConflictDoNothing({ target: schema.cards.id })
      .returning(publicCardColumns);

    if (inserted) {
      await tx.insert(schema.reviewEvents).values({
        id: nanoid(12),
        userId,
        problemId,
        cardId,
        eventType: "card_created",
        metadata: { source: "quiz", quizSessionId: session.id, quizItemId: item.id },
      });
      return { ok: true, card: inserted };
    }

    const [idempotentCard] = await tx
      .select(publicCardColumns)
      .from(schema.cards)
      .where(and(eq(schema.cards.id, cardId), eq(schema.cards.userId, userId)))
      .limit(1);
    if (!idempotentCard) return { ok: false, error: "card_id_collision" };
    return { ok: true, card: idempotentCard };
  });
}

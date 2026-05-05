import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { schemas } from "@ankify/core";
import { getDb, schema } from "@ankify/db";

export async function POST(req: Request, ctx: { params: Promise<{ id: string; sessionId: string }> }) {
  const { id: problemId, sessionId } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = schemas.quizSaveCardRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const db = getDb();
  const [session] = await db
    .select()
    .from(schema.quizSessions)
    .where(and(eq(schema.quizSessions.id, sessionId), eq(schema.quizSessions.problemId, problemId)));

  if (!session || session.status === "archived") {
    return NextResponse.json({ error: "quiz_session_not_found" }, { status: 404 });
  }

  const item = session.itemsJson.find((quizItem) => quizItem.id === parsed.data.itemId);
  if (!item) return NextResponse.json({ error: "quiz_item_not_found" }, { status: 404 });

  const cardId = nanoid(12);
  const correctChoice = item.choices[item.answerIndex] ?? "";
  const answer = [`**Correct answer:** ${correctChoice}`, item.explanation].filter(Boolean).join("\n\n");

  await db.transaction(async (tx) => {
    await tx.insert(schema.cards).values({
      id: cardId,
      problemId,
      aiStatus: "ready",
      errorMessage: null,
      question: item.question,
      answer,
    });
    await tx.insert(schema.reviewEvents).values({
      id: nanoid(12),
      problemId,
      cardId,
      eventType: "card_created",
      metadata: { source: "quiz", quizSessionId: session.id, quizItemId: item.id },
    });
  });

  const [card] = await db.select().from(schema.cards).where(eq(schema.cards.id, cardId));
  return NextResponse.json({ ok: true, card });
}

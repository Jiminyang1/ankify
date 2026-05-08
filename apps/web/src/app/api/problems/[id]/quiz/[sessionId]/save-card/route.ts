import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { schemas } from "@ankify/core";
import { getDb, schema } from "@ankify/db";
import { getRequestUser, unauthorizedResponse } from "@/lib/auth";

export async function POST(req: Request, ctx: { params: Promise<{ id: string; sessionId: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

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
    .where(and(eq(schema.quizSessions.userId, user.id), eq(schema.quizSessions.id, sessionId), eq(schema.quizSessions.problemId, problemId)));

  if (!session || session.status === "archived") {
    return NextResponse.json({ error: "quiz_session_not_found" }, { status: 404 });
  }

  const item = session.itemsJson.find((quizItem) => quizItem.id === parsed.data.itemId);
  if (!item) return NextResponse.json({ error: "quiz_item_not_found" }, { status: 404 });

  // Deterministic id: a second click for the same quiz item is idempotent —
  // the second insert hits the primary-key constraint and we just return the
  // existing card without writing a duplicate review event.
  const cardId = `qz_${session.id}_${item.id}`;
  const correctChoice = item.choices[item.answerIndex] ?? "";
  const answer = [`**Correct answer:** ${correctChoice}`, item.explanation].filter(Boolean).join("\n\n");

  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.cards)
      .values({
        id: cardId,
        userId: user.id,
        problemId,
        aiStatus: "ready",
        errorMessage: null,
        question: item.question,
        answer,
      })
      .onConflictDoNothing({ target: schema.cards.id })
      .returning({ id: schema.cards.id });

    if (inserted.length > 0) {
      await tx.insert(schema.reviewEvents).values({
        id: nanoid(12),
        userId: user.id,
        problemId,
        cardId,
        eventType: "card_created",
        metadata: { source: "quiz", quizSessionId: session.id, quizItemId: item.id },
      });
    }
  });

  const [card] = await db
    .select()
    .from(schema.cards)
    .where(and(eq(schema.cards.id, cardId), eq(schema.cards.userId, user.id)));
  if (!card) {
    return NextResponse.json({ error: "card_id_collision" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, card });
}

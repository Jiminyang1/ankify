import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { schemas, type QuizAnswer } from "@ankify/core";
import { getDb, schema } from "@ankify/db";
import { getRequestUser, unauthorizedResponse } from "@/lib/auth";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; sessionId: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const { id: problemId, sessionId } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = schemas.quizAnswerRequestSchema.safeParse(body);
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
  if (session.status !== "active") {
    return NextResponse.json({ error: "quiz_session_not_active" }, { status: 400 });
  }

  const item = session.itemsJson.find((quizItem) => quizItem.id === parsed.data.itemId);
  if (!item) return NextResponse.json({ error: "quiz_item_not_found" }, { status: 404 });
  if (session.answersJson.some((answer) => answer.itemId === item.id)) {
    return NextResponse.json({ error: "quiz_item_already_answered" }, { status: 400 });
  }

  const answer: QuizAnswer = {
    itemId: item.id,
    selectedIndex: parsed.data.selectedIndex,
    correct: parsed.data.selectedIndex === item.answerIndex,
    answeredAt: new Date().toISOString(),
  };
  const answers = [...session.answersJson, answer];
  const completed = answers.length === session.itemsJson.length;
  const score = completed ? answers.filter((a) => a.correct).length : null;
  const now = new Date();

  await db
    .update(schema.quizSessions)
    .set({
      answersJson: answers,
      status: completed ? "completed" : "active",
      score,
      updatedAt: now,
      completedAt: completed ? now : null,
    })
    .where(and(eq(schema.quizSessions.id, session.id), eq(schema.quizSessions.userId, user.id)));

  const [updated] = await db
    .select()
    .from(schema.quizSessions)
    .where(and(eq(schema.quizSessions.id, session.id), eq(schema.quizSessions.userId, user.id)));
  return NextResponse.json({
    ok: true,
    answer,
    item,
    completed,
    session: updated,
  });
}

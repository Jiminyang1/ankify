import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@ankify/db";
import { getCurrentQuizSession } from "@/server/ai-generation/quiz";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { toQuizSessionDto } from "@/server/public-dto";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const { id: problemId } = await ctx.params;
  const db = getDb();
  const [problem] = await db
    .select()
    .from(schema.problems)
    .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, user.id)));
  if (!problem) return NextResponse.json({ error: "problem_not_found" }, { status: 404 });

  const session = await getCurrentQuizSession(user.id, problemId);
  return NextResponse.json({ ok: true, session: session ? toQuizSessionDto(session) : null });
}

/** DELETE /api/problems/:id/quiz
 *  Wipes every quiz session row (active / completed / archived) for this
 *  problem so the next `generate` / `nextBatch` runs with a clean prompt and
 *  no history leakage. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const { id: problemId } = await ctx.params;
  const db = getDb();
  const [problem] = await db
    .select({ id: schema.problems.id })
    .from(schema.problems)
    .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, user.id)));
  if (!problem) return NextResponse.json({ error: "problem_not_found" }, { status: 404 });

  const result = await db
    .delete(schema.quizSessions)
    .where(and(eq(schema.quizSessions.userId, user.id), eq(schema.quizSessions.problemId, problemId)));

  return NextResponse.json({ ok: true, deleted: result.rowsAffected ?? null });
}

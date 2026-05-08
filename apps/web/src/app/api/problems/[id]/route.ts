import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { schemas } from "@ankify/core";
import { getDb, schema } from "@ankify/db";
import { getRequestUser, unauthorizedResponse } from "@/lib/auth";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const { id: problemId } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = schemas.problemNotesPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const db = getDb();
  const result = await db
    .update(schema.problems)
    .set({ notes: parsed.data.notes, updatedAt: new Date() })
    .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, user.id)))
    .returning({ id: schema.problems.id });

  if (result.length === 0) {
    return NextResponse.json({ error: "problem_not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

/** DELETE /api/problems/:id
 *  Permanently removes the problem and cascades to submissions, cards,
 *  quiz_sessions, and review_events (all FKs are onDelete: "cascade"). */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const { id: problemId } = await ctx.params;
  const db = getDb();

  const deleted = await db
    .delete(schema.problems)
    .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, user.id)))
    .returning({ id: schema.problems.id });

  if (deleted.length === 0) {
    return NextResponse.json({ error: "problem_not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

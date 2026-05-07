import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@ankify/db";
import { getRequestUser, unauthorizedResponse } from "@/lib/auth";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const { id: problemId } = await ctx.params;
  const body = await req.json().catch(() => null);
  const notes = typeof body?.notes === "string" ? body.notes : undefined;
  if (notes === undefined) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const db = getDb();
  const [problem] = await db
    .select()
    .from(schema.problems)
    .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, user.id)));
  if (!problem) return NextResponse.json({ error: "problem_not_found" }, { status: 404 });

  await db
    .update(schema.problems)
    .set({ notes, updatedAt: new Date() })
    .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, user.id)));

  return NextResponse.json({ ok: true });
}

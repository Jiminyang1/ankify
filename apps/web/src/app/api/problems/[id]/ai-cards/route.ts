import { NextResponse } from "next/server";
import { and, desc, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@ankify/db";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { publicCardColumns } from "@/server/public-dto";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const { id: problemId } = await ctx.params;
  const db = getDb();

  const candidates = await db
    .select(publicCardColumns)
    .from(schema.cards)
    .where(and(eq(schema.cards.userId, user.id), eq(schema.cards.problemId, problemId), ne(schema.cards.aiStatus, "ready")))
    .orderBy(desc(schema.cards.createdAt))
    .limit(25);

  return NextResponse.json({ ok: true, candidates });
}

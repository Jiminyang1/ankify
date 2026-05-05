import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { schemas } from "@ankify/core";
import { getDb, schema } from "@ankify/db";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: problemId } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = schemas.userCardManualCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const db = getDb();
  const [problem] = await db.select().from(schema.problems).where(eq(schema.problems.id, problemId));
  if (!problem) return NextResponse.json({ error: "problem_not_found" }, { status: 404 });

  const d = parsed.data;
  const cardId = nanoid(12);

  await db.transaction(async (tx) => {
    await tx.insert(schema.cards).values({
      id: cardId,
      problemId,
      aiStatus: "ready",
      question: d.question,
      answer: d.answer,
    });
    await tx.insert(schema.reviewEvents).values({
      id: nanoid(12),
      problemId,
      cardId,
      eventType: "card_created",
      metadata: { source: "manual" },
    });
  });

  return NextResponse.json({ ok: true, cardId }, { status: 201 });
}

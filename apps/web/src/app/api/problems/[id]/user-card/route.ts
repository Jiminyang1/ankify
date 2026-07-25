import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { schemas } from "@ankify/core";
import { getDb, schema } from "@ankify/db";
import { getRequestUser, unauthorizedResponse } from "@/lib/auth";
import { MAX_CARDS_PER_PROBLEM } from "@/lib/resource-limits";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const { id: problemId } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = schemas.userCardManualCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const db = getDb();
  const [problem] = await db
    .select()
    .from(schema.problems)
    .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, user.id)));
  if (!problem) return NextResponse.json({ error: "problem_not_found" }, { status: 404 });

  const d = parsed.data;
  const cardId = nanoid(12);
  let cardLimitReached = false;

  await db.transaction(async (tx) => {
    const [{ count } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(schema.cards)
      .where(
        and(
          eq(schema.cards.userId, user.id),
          eq(schema.cards.problemId, problemId),
        ),
      );
    if (count >= MAX_CARDS_PER_PROBLEM) {
      cardLimitReached = true;
      return;
    }

    await tx.insert(schema.cards).values({
      id: cardId,
      userId: user.id,
      problemId,
      aiStatus: "ready",
      question: d.question,
      answer: d.answer,
    });
    await tx.insert(schema.reviewEvents).values({
      id: nanoid(12),
      userId: user.id,
      problemId,
      cardId,
      eventType: "card_created",
      metadata: { source: "manual" },
    });
  });

  if (cardLimitReached) {
    return NextResponse.json(
      {
        error: "card_limit_reached",
        message: `This problem already has ${MAX_CARDS_PER_PROBLEM} cards. Delete one before adding another.`,
      },
      { status: 403 },
    );
  }

  return NextResponse.json({ ok: true, cardId }, { status: 201 });
}

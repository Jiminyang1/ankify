import { NextResponse } from "next/server";
import { schemas } from "@ankify/core";
import { getDb, schema } from "@ankify/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = schemas.updateCardPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const db = getDb();
  const [card] = await db.select().from(schema.cards).where(eq(schema.cards.id, id));
  if (!card) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const shouldFireEvent = parsed.data.aiStatus === "ready" && card.aiStatus !== "ready";

  await db.transaction(async (tx) => {
    await tx
      .update(schema.cards)
      .set({
        ...parsed.data,
        updatedAt: new Date(),
        ...(parsed.data.aiStatus === "ready" ? { errorMessage: null } : {}),
      })
      .where(eq(schema.cards.id, id));

    if (shouldFireEvent) {
      await tx.insert(schema.reviewEvents).values({
        id: nanoid(12),
        problemId: card.problemId,
        cardId: card.id,
        eventType: "card_created",
        metadata: { source: "ai" },
      });
    }
  });

  const [updated] = await db.select().from(schema.cards).where(eq(schema.cards.id, id));
  return NextResponse.json({ ok: true, card: updated });
}

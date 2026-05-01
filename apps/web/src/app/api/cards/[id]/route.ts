import { NextResponse } from "next/server";
import { schemas } from "@ankify/core";
import { getDb, schema } from "@ankify/db";
import { eq } from "drizzle-orm";

/** PATCH /api/cards/:id — edits a saved card or confirms a batch candidate. */
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

  await db
    .update(schema.cards)
    .set({
      ...parsed.data,
      ...(parsed.data.aiStatus === "ready" ? { errorMessage: null } : {}),
    })
    .where(eq(schema.cards.id, id));

  const [updated] = await db.select().from(schema.cards).where(eq(schema.cards.id, id));
  return NextResponse.json({ ok: true, card: updated });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@ankify/db";
import { inArray } from "drizzle-orm";

const deleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
});

/** DELETE /api/cards  body: { ids: string[] }
 *  Deletes one or many cards by id. review_events with onDelete: "set null"
 *  preserve the historical attempt records. */
export async function DELETE(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const db = getDb();
  const result = await db.delete(schema.cards).where(inArray(schema.cards.id, parsed.data.ids));

  return NextResponse.json({ ok: true, deleted: result.rowsAffected ?? parsed.data.ids.length });
}

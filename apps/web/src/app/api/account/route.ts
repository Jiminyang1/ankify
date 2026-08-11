import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@ankify/db";
import { getRequestSessionUser, unauthorizedResponse } from "@/server/auth";

const deleteAccountSchema = z
  .object({
    email: z.string().email().max(320),
    confirmation: z.literal("DELETE"),
  })
  .strict();

export async function DELETE(req: Request) {
  const user = await getRequestSessionUser(req);
  if (!user) return unauthorizedResponse();

  const body = await req.json().catch(() => null);
  const parsed = deleteAccountSchema.safeParse(body);
  if (!parsed.success || parsed.data.email.toLowerCase() !== user.email.toLowerCase()) {
    return NextResponse.json({ error: "confirmation_mismatch" }, { status: 400 });
  }

  const db = getDb();
  const deleted = await db
    .delete(schema.user)
    .where(eq(schema.user.id, user.id))
    .returning({ id: schema.user.id });
  if (deleted.length === 0) {
    return NextResponse.json({ error: "account_not_found" }, { status: 404 });
  }

  return NextResponse.json(
    { ok: true },
    {
      headers: {
        "Cache-Control": "no-store",
        "Clear-Site-Data": '"cookies", "storage"',
      },
    },
  );
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestSessionUser, unauthorizedResponse } from "@/server/auth";
import { resetStudyData } from "@/server/study-data-reset";

const resetSchema = z.object({ confirmation: z.literal("RESET") }).strict();

export async function POST(req: Request) {
  const user = await getRequestSessionUser(req);
  if (!user) return unauthorizedResponse();

  const parsed = resetSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "confirmation_mismatch" }, { status: 400 });
  }

  await resetStudyData(user.id);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

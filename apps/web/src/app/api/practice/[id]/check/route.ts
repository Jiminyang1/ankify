import { NextResponse } from "next/server";
import { practiceCheckAnswerSchema } from "@ankify/contracts";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { PRACTICE_ERROR_STATUS, answerCheck } from "@/server/practice";

/** POST /api/practice/:id/check — `{ itemId, choice }`; graded on the server. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  const parsed = practiceCheckAnswerSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const { id } = await ctx.params;
  const result = await answerCheck(user.id, id, parsed.data.itemId, parsed.data.choice);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: PRACTICE_ERROR_STATUS[result.error] });
  return NextResponse.json({ ok: true, session: result.session });
}

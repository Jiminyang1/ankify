import { NextResponse } from "next/server";
import { practiceRecallSchema } from "@ankify/contracts";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { PRACTICE_ERROR_STATUS, recordRecall } from "@/server/practice";

/** POST /api/practice/:id/recall — `{ key, result }` for one card. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  const parsed = practiceRecallSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const { id } = await ctx.params;
  const result = await recordRecall(user.id, id, parsed.data.key, parsed.data.result);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: PRACTICE_ERROR_STATUS[result.error] });
  return NextResponse.json({ ok: true, session: result.session });
}

import { NextResponse } from "next/server";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { PRACTICE_ERROR_STATUS, endPractice } from "@/server/practice";

/** POST /api/practice/:id/end — the user ends the session early. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  const { id } = await ctx.params;
  const result = await endPractice(user.id, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: PRACTICE_ERROR_STATUS[result.error] });
  return NextResponse.json({ ok: true, session: result.session });
}

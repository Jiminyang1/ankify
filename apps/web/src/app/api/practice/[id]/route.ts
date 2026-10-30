import { NextResponse } from "next/server";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { PRACTICE_ERROR_STATUS, getPractice } from "@/server/practice";

/** GET /api/practice/:id — session state; a talk-through's points stay hidden
 *  until each question settles. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  const { id } = await ctx.params;
  const result = await getPractice(user.id, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: PRACTICE_ERROR_STATUS[result.error] });
  return NextResponse.json({ ok: true, session: result.session }, { headers: { "Cache-Control": "private, no-store" } });
}

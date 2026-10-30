import { NextResponse } from "next/server";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { PRACTICE_ERROR_STATUS, getCurrentPractice, startPractice } from "@/server/practice";

/** GET /api/problems/:id/practice — the talk-through to resume: the active
 *  one. `session` is null when there's none. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  const { id } = await ctx.params;
  const session = await getCurrentPractice(user.id, id);
  return NextResponse.json({ ok: true, session }, { headers: { "Cache-Control": "private, no-store" } });
}

/** POST /api/problems/:id/practice — start a practice session (or return the
 *  active one). It returns at once; a problem's first practice gets its
 *  Solutions doc during the Coach turn that asks the first question. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  const { id } = await ctx.params;
  const result = await startPractice(user.id, id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: result.message },
      { status: PRACTICE_ERROR_STATUS[result.error] },
    );
  }
  return NextResponse.json({ ok: true, session: result.session });
}

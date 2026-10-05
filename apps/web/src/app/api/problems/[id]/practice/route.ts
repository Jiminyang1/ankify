import { NextResponse } from "next/server";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { PRACTICE_ERROR_STATUS, getCurrentPractice, startPractice } from "@/server/practice";

/** GET /api/problems/:id/practice — the session to resume: active, or
 *  finished and not yet debriefed. `session` is null when there's none. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  const { id } = await ctx.params;
  const session = await getCurrentPractice(user.id, id);
  return NextResponse.json({ ok: true, session }, { headers: { "Cache-Control": "private, no-store" } });
}

/** POST /api/problems/:id/practice — start a practice session (or return the
 *  active one). */
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

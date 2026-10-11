import { NextResponse } from "next/server";
import { getActiveModel } from "@/server/ai";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { PRACTICE_ERROR_STATUS, getCurrentPractice, startPractice } from "@/server/practice";

// The first practice of a problem writes its Solutions doc.
export const maxDuration = 120;

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
 *  active one). The first one on a problem writes its Solutions doc, which is
 *  covered by the Coach turn that asks the first question (no extra credit). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  const { id } = await ctx.params;
  // Without AI the session still starts; the Coach turn reports the setup error.
  const ai = await getActiveModel(user.id).catch(() => undefined);
  const result = await startPractice(user.id, id, { ai });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: result.message },
      { status: PRACTICE_ERROR_STATUS[result.error] },
    );
  }
  return NextResponse.json({ ok: true, session: result.session });
}

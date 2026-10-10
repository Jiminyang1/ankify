import { NextResponse } from "next/server";
import { practiceDisputeSchema } from "@ankify/contracts";
import { getActiveModel } from "@/server/ai";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { PRACTICE_ERROR_STATUS, disputeTalkGrade } from "@/server/practice";
import { RATE_LIMITS, checkRateLimit, rateLimitResponse } from "@/server/rate-limit";
import { readJsonBody } from "@/server/request-body";

export const maxDuration = 120;

/** POST /api/practice/:id/dispute — "I did say that": re-judge one settled
 *  question of a talk-through. Once per question; the grade only goes up. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  const body = await readJsonBody(req, 2_000);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
  const parsed = practiceDisputeSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }
  const limit = await checkRateLimit(user.id, "agent", RATE_LIMITS.agent);
  if (!limit.ok) return rateLimitResponse(limit.retryAfterSec);
  let ai: Awaited<ReturnType<typeof getActiveModel>>;
  try {
    ai = await getActiveModel(user.id);
  } catch {
    return NextResponse.json({ error: "ai_not_configured" }, { status: 400 });
  }
  const { id } = await ctx.params;
  try {
    const result = await disputeTalkGrade({ userId: user.id, sessionId: id, targetId: parsed.data.targetId, ...ai });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: PRACTICE_ERROR_STATUS[result.error] });
    return NextResponse.json({ ok: true, session: result.session });
  } catch (error) {
    console.error("[practice] dispute failed", error);
    return NextResponse.json({ error: "judge_failed", message: "Couldn't check it again. Try once more." }, { status: 502 });
  }
}

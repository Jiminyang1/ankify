import { NextResponse } from "next/server";
import { practiceSessionRatingSchema } from "@ankify/contracts";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { isWorkflowEnabled, workflowDisabledResponse } from "@/server/features";
import { sessionErrorResponse } from "@/server/practice-sessions/http";
import { ratePracticeSession } from "@/server/practice-sessions/scheduling";
import { RATE_LIMITS, checkRateLimit, rateLimitResponse } from "@/server/rate-limit";
import { readJsonBody } from "@/server/request-body";

/** POST /api/practice-sessions/:id/rating — the one FSRS rating of a
 *  completed review. Idempotent per `requestId`. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  if (!isWorkflowEnabled("session_rating")) return workflowDisabledResponse();

  const limit = await checkRateLimit(user.id, "sessions", RATE_LIMITS.sessions);
  if (!limit.ok) return rateLimitResponse(limit.retryAfterSec);

  const body = await readJsonBody(req, 4_000);
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: body.error === "payload_too_large" ? 413 : 400 });
  }
  const parsed = practiceSessionRatingSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const { id } = await ctx.params;
  const result = await ratePracticeSession(user.id, id, parsed.data);
  if (!result.ok) return sessionErrorResponse(result);
  return NextResponse.json(result.response);
}

import { NextResponse } from "next/server";
import { practiceSessionSubmissionsSchema } from "@ankify/contracts";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { isWorkflowEnabled, workflowDisabledResponse } from "@/server/features";
import { ingestSessionObservations } from "@/server/practice-sessions/commands";
import { requestOwnerToken, sessionErrorResponse } from "@/server/practice-sessions/http";
import { RATE_LIMITS, checkRateLimit, rateLimitResponse } from "@/server/rate-limit";
import { readJsonBody } from "@/server/request-body";

/** POST /api/practice-sessions/:id/submissions — up to 20 observations, each
 *  idempotent by its LeetCode submission id or client observation id. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  if (!isWorkflowEnabled("practice_sessions")) return workflowDisabledResponse();

  const limit = await checkRateLimit(user.id, "sessions", RATE_LIMITS.sessions);
  if (!limit.ok) return rateLimitResponse(limit.retryAfterSec);

  const body = await readJsonBody(req);
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: body.error === "payload_too_large" ? 413 : 400 });
  }
  const parsed = practiceSessionSubmissionsSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const { id } = await ctx.params;
  const result = await ingestSessionObservations(user.id, id, parsed.data, new Date(), requestOwnerToken(req));
  if (!result.ok) return sessionErrorResponse(result);
  return NextResponse.json(result.response);
}

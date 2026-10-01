import { NextResponse } from "next/server";
import { practiceSessionCommandSchema } from "@ankify/contracts";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { isWorkflowEnabled, workflowDisabledResponse } from "@/server/features";
import { runSessionCommand } from "@/server/practice-sessions/commands";
import { sessionErrorResponse } from "@/server/practice-sessions/http";
import { RATE_LIMITS, checkRateLimit, rateLimitResponse } from "@/server/rate-limit";
import { readJsonBody } from "@/server/request-body";

/** POST /api/practice-sessions/:id/commands — heartbeat, resume, takeover,
 *  set_baseline, finish, abandon, dismiss_rating (defer_rating is retired). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  if (!isWorkflowEnabled("practice_sessions")) return workflowDisabledResponse();

  const limit = await checkRateLimit(user.id, "sessions", RATE_LIMITS.sessions);
  if (!limit.ok) return rateLimitResponse(limit.retryAfterSec);

  const body = await readJsonBody(req, 16_000);
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: body.error === "payload_too_large" ? 413 : 400 });
  }
  const parsed = practiceSessionCommandSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const { id } = await ctx.params;
  const result = await runSessionCommand(user.id, id, parsed.data);
  if (!result.ok) return sessionErrorResponse(result);
  return NextResponse.json(result.response);
}

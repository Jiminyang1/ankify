import { NextResponse } from "next/server";
import { suggestionActionSchema } from "@ankify/contracts";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { isWorkflowEnabled, workflowDisabledResponse } from "@/server/features";
import { RATE_LIMITS, checkRateLimit, rateLimitResponse } from "@/server/rate-limit";
import { readJsonBody } from "@/server/request-body";
import { actOnSuggestion } from "@/server/suggestions/commands";
import { suggestionErrorResponse } from "@/server/suggestions/http";

/** POST /api/suggestions/:id/actions — skip, already attempted, or start
 *  practice. Each suggestion is acted on once; idempotent per `requestId`. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  if (!isWorkflowEnabled("suggestions")) return workflowDisabledResponse();
  if (!isWorkflowEnabled("practice_sessions")) return workflowDisabledResponse();

  const limit = await checkRateLimit(user.id, "suggestions", RATE_LIMITS.suggestions);
  if (!limit.ok) return rateLimitResponse(limit.retryAfterSec);

  const body = await readJsonBody(req, 4_096);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.error === "payload_too_large" ? 413 : 400 });
  const parsed = suggestionActionSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });

  const { id } = await ctx.params;
  const result = await actOnSuggestion(user.id, id, parsed.data);
  if (!result.ok) return suggestionErrorResponse(result);
  return NextResponse.json(result.response);
}

import { NextResponse } from "next/server";
import { suggestionAllocateSchema } from "@ankify/contracts";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { isWorkflowEnabled, workflowDisabledResponse } from "@/server/features";
import { RATE_LIMITS, checkRateLimit, rateLimitResponse } from "@/server/rate-limit";
import { readJsonBody } from "@/server/request-body";
import { allocateSuggestion, listSuggestions } from "@/server/suggestions/commands";
import { suggestionErrorResponse } from "@/server/suggestions/http";

/** GET /api/suggestions — today's new-problem suggestions, oldest first. */
export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  if (!isWorkflowEnabled("suggestions")) return workflowDisabledResponse();
  return NextResponse.json(await listSuggestions(user.id), { headers: { "Cache-Control": "private, no-store" } });
}

/** POST /api/suggestions — `daily` returns the day's suggestion, allocating it
 *  once; `extra` adds one more. Idempotent per `requestId`. */
export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  if (!isWorkflowEnabled("suggestions")) return workflowDisabledResponse();

  const limit = await checkRateLimit(user.id, "suggestions", RATE_LIMITS.suggestions);
  if (!limit.ok) return rateLimitResponse(limit.retryAfterSec);

  const body = await readJsonBody(req, 4_096);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.error === "payload_too_large" ? 413 : 400 });
  const parsed = suggestionAllocateSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });

  const result = await allocateSuggestion(user.id, parsed.data);
  if (!result.ok) return suggestionErrorResponse(result);
  const created = result.response.suggestion !== null && !result.response.idempotentReplay;
  return NextResponse.json(result.response, { status: created ? 201 : 200 });
}

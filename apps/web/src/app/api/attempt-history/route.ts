import { NextResponse } from "next/server";
import { attemptHistoryMergeSchema } from "@ankify/contracts";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { isWorkflowEnabled, workflowDisabledResponse } from "@/server/features";
import { RATE_LIMITS, checkRateLimit, rateLimitResponse } from "@/server/rate-limit";
import { readJsonBody } from "@/server/request-body";
import { mergeAttemptHistory } from "@/server/suggestions/history";

/** POST /api/attempt-history — merge attempted problems read from LeetCode
 *  (with how far the read got) or stated by the user. */
export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  if (!isWorkflowEnabled("suggestions")) return workflowDisabledResponse();

  const limit = await checkRateLimit(user.id, "suggestions", RATE_LIMITS.suggestions);
  if (!limit.ok) return rateLimitResponse(limit.retryAfterSec);

  const body = await readJsonBody(req, 128_000);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.error === "payload_too_large" ? 413 : 400 });
  const parsed = attemptHistoryMergeSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  return NextResponse.json(await mergeAttemptHistory(user.id, parsed.data));
}

import { NextResponse } from "next/server";
import { practiceImprovementCreateSchema } from "@ankify/contracts";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { createImprovement, listSessionImprovements } from "@/server/mistakes";
import { RATE_LIMITS, checkRateLimit, rateLimitResponse } from "@/server/rate-limit";
import { readJsonBody } from "@/server/request-body";

/** POST /api/mistakes/improvements — confirm that a completed session handled
 *  a dimension well. Idempotent per `requestId`. */
export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const limit = await checkRateLimit(user.id, "mistakes", RATE_LIMITS.mistakes);
  if (!limit.ok) return rateLimitResponse(limit.retryAfterSec);

  const body = await readJsonBody(req, 4_000);
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: body.error === "payload_too_large" ? 413 : 400 });
  }
  const parsed = practiceImprovementCreateSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const result = await createImprovement(user.id, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.error === "session_not_found" ? 404 : 409 });
  }
  return NextResponse.json(result, { status: result.idempotentReplay || result.deduplicated ? 200 : 201 });
}

/** GET /api/mistakes/improvements?practiceSessionId= */
export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  const sessionId = new URL(req.url).searchParams.get("practiceSessionId");
  if (!sessionId || sessionId.length > 64) return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  return NextResponse.json({ improvements: await listSessionImprovements(user.id, sessionId) });
}

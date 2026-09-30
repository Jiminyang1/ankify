import { NextResponse } from "next/server";
import { practiceSessionListQuerySchema, practiceSessionStartSchema } from "@ankify/contracts";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { isWorkflowEnabled, workflowDisabledResponse } from "@/server/features";
import { startPracticeSession } from "@/server/practice-sessions/commands";
import { sessionErrorResponse } from "@/server/practice-sessions/http";
import { InvalidSessionsCursorError, listPracticeSessions } from "@/server/practice-sessions/queries";
import { RATE_LIMITS, checkRateLimit, rateLimitResponse } from "@/server/rate-limit";
import { readJsonBody } from "@/server/request-body";

/** POST /api/practice-sessions — start a session, or resume the problem's
 *  open one. Idempotent per `requestId`. */
export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  if (!isWorkflowEnabled("practice_sessions")) return workflowDisabledResponse();

  const limit = await checkRateLimit(user.id, "sessions", RATE_LIMITS.sessions);
  if (!limit.ok) return rateLimitResponse(limit.retryAfterSec);

  const body = await readJsonBody(req, 512_000);
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: body.error === "payload_too_large" ? 413 : 400 });
  }
  const parsed = practiceSessionStartSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const result = await startPracticeSession(user.id, parsed.data);
  if (!result.ok) return sessionErrorResponse(result);
  return NextResponse.json(result.response, {
    status: result.response.created && !result.response.idempotentReplay ? 201 : 200,
  });
}

/** GET /api/practice-sessions?problemId=&cursor=&limit= — history, newest first. */
export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  if (!isWorkflowEnabled("practice_sessions")) return workflowDisabledResponse();

  const parsed = practiceSessionListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    return NextResponse.json(await listPracticeSessions(user.id, parsed.data));
  } catch (error) {
    if (!(error instanceof InvalidSessionsCursorError)) throw error;
    return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
  }
}

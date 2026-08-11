import { NextResponse } from "next/server";
import { captureProblemSchema } from "@ankify/contracts";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { captureProblem } from "@/server/capture";
import { RATE_LIMITS, checkRateLimit, rateLimitResponse } from "@/server/rate-limit";
import { readJsonBody } from "@/server/request-body";

export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const limit = await checkRateLimit(user.id, "capture", RATE_LIMITS.capture);
  if (!limit.ok) return rateLimitResponse(limit.retryAfterSec);

  const body = await readJsonBody(req);
  if (!body.ok) {
    return NextResponse.json(
      { error: body.error },
      { status: body.error === "payload_too_large" ? 413 : 400 },
    );
  }

  const parsed = captureProblemSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }
  const result = await captureProblem(user.id, parsed.data);
  if ("error" in result) {
    return NextResponse.json(result, {
      status: result.error === "duplicate_problem_conflict" ? 409 : 403,
    });
  }
  return NextResponse.json(result);
}

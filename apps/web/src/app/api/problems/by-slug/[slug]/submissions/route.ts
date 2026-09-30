import { NextResponse } from "next/server";
import { submissionSyncSchema } from "@ankify/contracts";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { appendSubmissions, listLeetcodeSubmissionIds } from "@/server/capture";
import { RATE_LIMITS, checkRateLimit, rateLimitResponse } from "@/server/rate-limit";
import { readJsonBody } from "@/server/request-body";

type Context = { params: Promise<{ slug: string }> };

/** LeetCode submission ids ankify already has for this problem. */
export async function GET(req: Request, ctx: Context) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const { slug } = await ctx.params;
  const ids = await listLeetcodeSubmissionIds(user.id, slug);
  if (!ids) return NextResponse.json({ error: "not_captured" }, { status: 404 });
  return NextResponse.json({ leetcodeSubmissionIds: ids });
}

/** Append submissions to a captured problem without touching the problem row. */
export async function POST(req: Request, ctx: Context) {
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
  const parsed = submissionSyncSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const { slug } = await ctx.params;
  const result = await appendSubmissions(user.id, slug, parsed.data.submissions);
  if (!result) return NextResponse.json({ error: "not_captured" }, { status: 404 });
  return NextResponse.json(result);
}

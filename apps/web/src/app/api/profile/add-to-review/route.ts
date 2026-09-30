import { NextResponse } from "next/server";
import { addToReviewSchema } from "@ankify/contracts";
import { addPlanProblemsToReview } from "@/server/add-to-review";
import { getRequestSessionUser, unauthorizedResponse } from "@/server/auth";
import { RATE_LIMITS, checkRateLimit, rateLimitResponse } from "@/server/rate-limit";
import { readJsonBody } from "@/server/request-body";

/** Capture study-plan problems (by slug) into the deck from LeetCode's public data. */
export async function POST(req: Request) {
  const user = await getRequestSessionUser(req);
  if (!user) return unauthorizedResponse();

  const limit = await checkRateLimit(user.id, "leetcode", RATE_LIMITS.leetcode);
  if (!limit.ok) return rateLimitResponse(limit.retryAfterSec);

  const body = await readJsonBody(req);
  if (!body.ok) {
    return NextResponse.json(
      { error: body.error },
      { status: body.error === "payload_too_large" ? 413 : 400 },
    );
  }
  const parsed = addToReviewSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  return NextResponse.json(await addPlanProblemsToReview(user.id, parsed.data.slugs));
}

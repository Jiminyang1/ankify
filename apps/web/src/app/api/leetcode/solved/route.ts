import { NextResponse } from "next/server";
import { leetcodeSolvedSyncSchema } from "@ankify/contracts";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { saveLeetcodeSolved } from "@/server/leetcode-account";
import { markExtensionConnected } from "@/server/onboarding";
import { RATE_LIMITS, checkRateLimit, rateLimitResponse } from "@/server/rate-limit";
import { readJsonBody } from "@/server/request-body";

/** The extension's daily snapshot of the signed-in LeetCode user's solved
 *  problems. Also links that LeetCode account when it isn't linked yet. */
export async function POST(req: Request) {
  const user = await getRequestUser(req);
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
  const parsed = leetcodeSolvedSyncSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const result = await saveLeetcodeSolved(user.id, parsed.data.username, parsed.data.slugs);
  if ("error" in result) return NextResponse.json(result, { status: 400 });
  // Only the extension posts here, so this also proves it's connected.
  await markExtensionConnected(user.id).catch((error) => {
    console.warn("[onboarding] failed to record extension connection", error);
  });
  return NextResponse.json(result);
}

import { NextResponse } from "next/server";
import { studyPlanImportSchema } from "@ankify/contracts";
import { getRequestSessionUser, unauthorizedResponse } from "@/server/auth";
import { RATE_LIMITS, checkRateLimit, rateLimitResponse } from "@/server/rate-limit";
import { readJsonBody } from "@/server/request-body";
import { importLeetcodeList } from "@/server/study-plans";

const ERROR_STATUS = {
  invalid_link: 400,
  unsupported_site: 400,
  not_found: 404,
  empty: 422,
  too_many_lists: 409,
  leetcode_unavailable: 502,
} as const;

/** Import a public LeetCode problem list as a study plan and switch to it. */
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
  const parsed = studyPlanImportSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const result = await importLeetcodeList(user.id, parsed.data.link);
  if ("error" in result) return NextResponse.json(result, { status: ERROR_STATUS[result.error] });
  return NextResponse.json(result);
}

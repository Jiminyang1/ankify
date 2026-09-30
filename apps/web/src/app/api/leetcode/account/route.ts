import { NextResponse } from "next/server";
import { leetcodeAccountLinkSchema } from "@ankify/contracts";
import { getRequestSessionUser, unauthorizedResponse } from "@/server/auth";
import { linkLeetcodeAccount, unlinkLeetcodeAccount } from "@/server/leetcode-account";
import { RATE_LIMITS, checkRateLimit, rateLimitResponse } from "@/server/rate-limit";
import { readJsonBody } from "@/server/request-body";

const ERROR_STATUS = {
  invalid_profile: 400,
  unsupported_site: 400,
  user_not_found: 404,
  leetcode_unavailable: 502,
} as const;

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
  const parsed = leetcodeAccountLinkSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const result = await linkLeetcodeAccount(user.id, parsed.data.profile);
  if ("error" in result) return NextResponse.json(result, { status: ERROR_STATUS[result.error] });
  return NextResponse.json(result);
}

export async function DELETE(req: Request) {
  const user = await getRequestSessionUser(req);
  if (!user) return unauthorizedResponse();
  await unlinkLeetcodeAccount(user.id);
  return NextResponse.json({ ok: true });
}

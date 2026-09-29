import { NextResponse } from "next/server";
import { mistakePatchSchema } from "@ankify/contracts";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { deleteMistake, updateMistake } from "@/server/mistakes";
import { RATE_LIMITS, checkRateLimit, rateLimitResponse } from "@/server/rate-limit";
import { readJsonBody } from "@/server/request-body";

/** PATCH /api/mistakes/:id — edit, resolve, or confirm/dismiss a candidate. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const limit = await checkRateLimit(user.id, "mistakes", RATE_LIMITS.mistakes);
  if (!limit.ok) return rateLimitResponse(limit.retryAfterSec);

  const { id } = await ctx.params;
  const body = await readJsonBody(req, 64_000);
  if (!body.ok) {
    return NextResponse.json(
      { error: body.error },
      { status: body.error === "payload_too_large" ? 413 : 400 },
    );
  }
  const parsed = mistakePatchSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const result = await updateMistake(user.id, id, parsed.data);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "mistake_not_found" ? 404 : 409 },
    );
  }
  return NextResponse.json(result);
}

/** DELETE /api/mistakes/:id */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const limit = await checkRateLimit(user.id, "mistakes", RATE_LIMITS.mistakes);
  if (!limit.ok) return rateLimitResponse(limit.retryAfterSec);

  const { id } = await ctx.params;
  if (!(await deleteMistake(user.id, id))) {
    return NextResponse.json({ error: "mistake_not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

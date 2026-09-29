import { NextResponse } from "next/server";
import { mistakeCreateSchema, mistakeListQuerySchema } from "@ankify/contracts";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { InvalidMistakesCursorError, createMistake, listMistakes } from "@/server/mistakes";
import { RATE_LIMITS, checkRateLimit, rateLimitResponse } from "@/server/rate-limit";
import { readJsonBody } from "@/server/request-body";

/** GET /api/mistakes?problemId=&category=&status=&cursor=&limit= — the user's
 *  mistake records, newest first. `status` defaults to `confirmed`. */
export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const { searchParams } = new URL(req.url);
  const parsed = mistakeListQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    return NextResponse.json(await listMistakes(user.id, parsed.data));
  } catch (error) {
    if (!(error instanceof InvalidMistakesCursorError)) throw error;
    return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
  }
}

/** POST /api/mistakes — record a confirmed mistake. Idempotent per `requestId`;
 *  a second record for the same source and category returns the first. */
export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const limit = await checkRateLimit(user.id, "mistakes", RATE_LIMITS.mistakes);
  if (!limit.ok) return rateLimitResponse(limit.retryAfterSec);

  const body = await readJsonBody(req, 64_000);
  if (!body.ok) {
    return NextResponse.json(
      { error: body.error },
      { status: body.error === "payload_too_large" ? 413 : 400 },
    );
  }

  const parsed = mistakeCreateSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const result = await createMistake(user.id, parsed.data);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "mistake_request_conflict" ? 409 : 404 },
    );
  }
  return NextResponse.json(result, { status: result.idempotentReplay || result.deduplicated ? 200 : 201 });
}

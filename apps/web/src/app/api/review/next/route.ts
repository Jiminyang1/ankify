import { NextResponse } from "next/server";
import { getRequestUser, unauthorizedResponse } from "@/lib/auth";
import { loadNextReview } from "@/lib/next-review";

/**
 * Returns a problem to review with FSRS scheduling previews for each rating.
 *
 * Default: the earliest-due problem, gated by the daily review limit.
 * `?problemId=<id>`: that specific problem, reviewed ahead of schedule —
 * bypasses both the due condition and the daily limit. FSRS still schedules
 * correctly because `rate()` recomputes elapsed time from `lastReview`.
 */
export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const targetId = new URL(req.url).searchParams.get("problemId");
  return NextResponse.json(await loadNextReview(user.id, targetId));
}

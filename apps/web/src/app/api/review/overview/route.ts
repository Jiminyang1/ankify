import { NextResponse } from "next/server";
import { afterResponse } from "@/server/after-response";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { loadReviewOverview } from "@/server/review-overview";
import { redispatchStrandedJobs } from "@/server/session-analysis/jobs";

/** GET /api/review/overview?limit=20 — due, overdue, and upcoming problems,
 *  pending ratings, open sessions, and today's counts. */
export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const requested = Number(new URL(req.url).searchParams.get("limit") ?? "20");
  const cap = Number.isFinite(requested) && requested >= 0 ? Math.min(Math.trunc(requested), 100) : 20;
  // The popup loads this on every open: re-send the user's stranded AI jobs.
  afterResponse(() => redispatchStrandedJobs({ userId: user.id }));
  return NextResponse.json(await loadReviewOverview(user.id, cap), {
    headers: { "Cache-Control": "private, no-store" },
  });
}

import { NextResponse } from "next/server";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { loadReviewQueueData } from "@/server/review-queue-data";

/** GET /api/review/queue?limit=20 — today's due problem list + queue stats.
 *  `limit=0` returns queue stats only, skipping the problem-list queries. */
export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const { searchParams } = new URL(req.url);
  const requested = Number(searchParams.get("limit") ?? "20");
  const cap = Number.isFinite(requested) && requested >= 0 ? Math.min(requested, 100) : 20;
  return NextResponse.json(await loadReviewQueueData(user.id, cap));
}

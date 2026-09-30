import { NextResponse } from "next/server";
import { afterResponse } from "@/server/after-response";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { redispatchStrandedJobs } from "@/server/session-analysis/jobs";
import { getSessionAnalysisState } from "@/server/session-analysis/queries";

/** GET /api/practice-sessions/:id/analysis — the session's latest analysis,
 *  its job, AI candidate records, and whether a manual analysis can start.
 *  Start one with POST /api/ai-jobs (`session_analyze`). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  const { id } = await ctx.params;
  const state = await getSessionAnalysisState(user.id, id);
  if (!state) return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  // Clients poll this while a job runs: a good moment to re-send any of the
  // user's jobs whose dispatch never reached the queue.
  afterResponse(() => redispatchStrandedJobs({ userId: user.id }));
  return NextResponse.json(state, { headers: { "Cache-Control": "private, no-store" } });
}

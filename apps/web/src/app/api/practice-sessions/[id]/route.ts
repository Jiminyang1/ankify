import { NextResponse } from "next/server";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { isWorkflowEnabled, workflowDisabledResponse } from "@/server/features";
import { requestOwnerToken } from "@/server/practice-sessions/http";
import { getPracticeSessionDetail } from "@/server/practice-sessions/queries";

/** GET /api/practice-sessions/:id — the session, its problem, and observations. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  if (!isWorkflowEnabled("practice_sessions")) return workflowDisabledResponse();

  const { id } = await ctx.params;
  const detail = await getPracticeSessionDetail(user.id, id, requestOwnerToken(req));
  if (!detail) return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  return NextResponse.json(detail, { headers: { "Cache-Control": "private, no-store" } });
}

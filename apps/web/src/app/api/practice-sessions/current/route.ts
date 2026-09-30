import { NextResponse } from "next/server";
import { practiceSessionCurrentQuerySchema } from "@ankify/contracts";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { isWorkflowEnabled, workflowDisabledResponse } from "@/server/features";
import { requestOwnerToken } from "@/server/practice-sessions/http";
import { getCurrentPracticeSession } from "@/server/practice-sessions/queries";

/** GET /api/practice-sessions/current?slug=|problemId= — the problem's Ankify
 *  status, open session, and any completed review awaiting a rating. */
export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  if (!isWorkflowEnabled("practice_sessions")) return workflowDisabledResponse();

  const parsed = practiceSessionCurrentQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query", issues: parsed.error.issues }, { status: 400 });
  }
  return NextResponse.json(await getCurrentPracticeSession(user.id, parsed.data, requestOwnerToken(req)), {
    headers: { "Cache-Control": "private, no-store" },
  });
}

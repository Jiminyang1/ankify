import { NextResponse } from "next/server";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { listProblemWeaknesses } from "@/server/weaknesses";

/** GET /api/problems/:id/weaknesses — this problem's weak spots, active first. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  const { id } = await ctx.params;
  const weaknesses = await listProblemWeaknesses(user.id, id);
  return NextResponse.json({ ok: true, weaknesses }, { headers: { "Cache-Control": "private, no-store" } });
}

import { NextResponse } from "next/server";
import { AgentRequestError, dismissAgentProposal } from "@/server/agent/store";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  const { id } = await ctx.params;
  try {
    const step = await dismissAgentProposal(user.id, id);
    return NextResponse.json({ ok: true, step });
  } catch (error) {
    if (error instanceof AgentRequestError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    throw error;
  }
}

import { NextResponse } from "next/server";
import { getAgentSessionSnapshot } from "@/server/agent/store";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const { id } = await context.params;
  const snapshot = await getAgentSessionSnapshot(user.id, id);
  if (!snapshot) {
    return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, snapshot });
}

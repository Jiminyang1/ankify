import { NextResponse } from "next/server";
import { listAgentSessions } from "@/server/agent/store";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";

export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const sessions = await listAgentSessions(user.id);
  return NextResponse.json({ ok: true, sessions });
}

import { NextResponse } from "next/server";
import { agentSessionPatchSchema } from "@ankify/contracts";
import {
  AgentRequestError,
  deleteAgentSession,
  getAgentSessionSnapshot,
  renameAgentSession,
} from "@/server/agent/store";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { readJsonBody } from "@/server/request-body";

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

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const body = await readJsonBody(req, 2_000);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
  const parsed = agentSessionPatchSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const { id } = await context.params;
  try {
    const session = await renameAgentSession(user.id, id, parsed.data.title);
    return NextResponse.json({ ok: true, session });
  } catch (error) {
    if (error instanceof AgentRequestError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    throw error;
  }
}

/** Permanently deletes a session and its cascaded runs, messages, and steps. */
export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const { id } = await context.params;
  try {
    await deleteAgentSession(user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AgentRequestError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    throw error;
  }
}

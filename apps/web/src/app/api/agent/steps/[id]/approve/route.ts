import { NextResponse } from "next/server";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import {
  AiJobRequestError,
  getOwnedAiJob,
  toPublicAiJob,
} from "@/server/ai-generation/jobs";
import { startAiJobForUser } from "@/server/ai-generation/start";
import {
  AgentRequestError,
  acceptAgentProposal,
  getOwnedAgentStep,
} from "@/server/agent/store";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  const { id } = await ctx.params;
  const step = await getOwnedAgentStep(user.id, id);
  if (!step || step.kind !== "proposal" || !step.proposalJson) {
    return NextResponse.json({ error: "proposal_not_found" }, { status: 404 });
  }

  try {
    if (step.status === "accepted" && step.aiJobId) {
      const job = await getOwnedAiJob(user.id, step.aiJobId);
      if (!job) return NextResponse.json({ error: "job_not_found" }, { status: 404 });
      return NextResponse.json({ ok: true, step, job: toPublicAiJob(job) });
    }
    if (step.status !== "pending") {
      throw new AgentRequestError("proposal_not_pending", "This proposal is no longer pending.", 409);
    }
    const job = await startAiJobForUser(user.id, step.proposalJson);
    const accepted = await acceptAgentProposal(user.id, step.id, job.id);
    return NextResponse.json({ ok: true, step: accepted, job: toPublicAiJob(job) }, { status: 202 });
  } catch (error) {
    if (error instanceof AgentRequestError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    if (error instanceof AiJobRequestError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        {
          status: error.status,
          headers:
            error.retryAfterSec
              ? { "Retry-After": String(error.retryAfterSec) }
              : undefined,
        },
      );
    }
    throw error;
  }
}

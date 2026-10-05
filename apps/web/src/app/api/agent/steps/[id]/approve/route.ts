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
import { DOC_WRITE_STATUS, applyProblemDocEdit } from "@/server/problem-docs";
import { addWeaknessCategory } from "@/server/weaknesses";

const DOC_EDIT_MESSAGES: Partial<Record<keyof typeof DOC_WRITE_STATUS, string>> = {
  version_conflict: "This doc changed since the suggestion. Ask the Coach again.",
  card_not_found: "That card is no longer in your Cards doc.",
  duplicate_prompt: "A card with that prompt already exists.",
  too_many_cards: "Your Cards doc is full. Remove a card first.",
  too_long: "This would make the doc too long.",
};

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
    const proposal = step.proposalJson;
    if (proposal.action === "doc_edit") {
      const applied = await applyProblemDocEdit(user.id, proposal.problemId, proposal.edit, proposal.baseVersion);
      if (!applied.ok) {
        return NextResponse.json(
          { error: applied.error, message: DOC_EDIT_MESSAGES[applied.error] ?? "Couldn't apply this suggestion." },
          { status: DOC_WRITE_STATUS[applied.error] },
        );
      }
      const accepted = await acceptAgentProposal(user.id, step.id, null);
      return NextResponse.json({ ok: true, step: accepted, docs: applied.docs });
    }
    if (proposal.action === "weakness_category") {
      await addWeaknessCategory(user.id, {
        key: proposal.key,
        name: proposal.name,
        description: proposal.description,
      });
      const accepted = await acceptAgentProposal(user.id, step.id, null);
      return NextResponse.json({ ok: true, step: accepted });
    }
    const job = await startAiJobForUser(user.id, proposal);
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

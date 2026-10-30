import { NextResponse } from "next/server";
import { isLegacyCardEdit } from "@ankify/contracts";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import {
  AgentRequestError,
  acceptAgentProposal,
  getOwnedAgentStep,
} from "@/server/agent/store";
import { DOC_WRITE_STATUS, applyProblemDocEdit } from "@/server/problem-docs";
import { addWeaknessCategory } from "@/server/weaknesses";

const DOC_EDIT_MESSAGES: Partial<Record<keyof typeof DOC_WRITE_STATUS, string>> = {
  version_conflict: "This doc changed since the suggestion. Ask the Coach again.",
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
    if (step.status !== "pending") {
      throw new AgentRequestError("proposal_not_pending", "This proposal is no longer pending.", 409);
    }
    const proposal = step.proposalJson;
    if (proposal.action === "doc_edit") {
      // A card edit from before the Cards doc moved into Notes.
      if (isLegacyCardEdit(proposal.edit)) {
        return NextResponse.json(
          {
            error: "cards_retired",
            message: "Cards are part of your Notes now, so this suggestion can't be applied. Ask the Coach again.",
          },
          { status: 410 },
        );
      }
      const applied = await applyProblemDocEdit(user.id, proposal.problemId, proposal.edit, proposal.baseVersion);
      if (!applied.ok) {
        return NextResponse.json(
          { error: applied.error, message: DOC_EDIT_MESSAGES[applied.error] ?? "Couldn't apply this suggestion." },
          { status: DOC_WRITE_STATUS[applied.error] },
        );
      }
      const accepted = await acceptAgentProposal(user.id, step.id);
      return NextResponse.json({ ok: true, step: accepted, docs: applied.docs });
    }
    if (proposal.action === "weakness_category") {
      await addWeaknessCategory(user.id, {
        key: proposal.key,
        name: proposal.name,
        description: proposal.description,
      });
      const accepted = await acceptAgentProposal(user.id, step.id);
      return NextResponse.json({ ok: true, step: accepted });
    }
    // A card or quiz generation proposed before those were removed.
    return NextResponse.json(
      {
        error: "generation_retired",
        message: "ankify no longer generates cards or quizzes, so this suggestion can't be applied. Ask the Coach for a Notes edit or a practice instead.",
      },
      { status: 410 },
    );
  } catch (error) {
    if (error instanceof AgentRequestError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    throw error;
  }
}

import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as approveStep } from "./agent/steps/[id]/approve/route";
import { POST as agentTurn } from "./agent/turns/route";
import { POST as createAiJob } from "./ai-jobs/route";

// Old clients and stale pages that call a suspended legacy workflow get its
// structured answer before any work: no Coach run, no job, no model request.
vi.mock("@/server/auth", () => ({
  getRequestUser: vi.fn(async () => ({ id: "legacy-user" })),
  unauthorizedResponse: () => Response.json({ error: "unauthorized" }, { status: 401 }),
}));
vi.mock("@/server/agent/runtime", () => ({ runStudyCoach: vi.fn() }));
vi.mock("@/server/agent/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/agent/store")>()),
  beginAgentTurn: vi.fn(),
  acceptAgentProposal: vi.fn(),
  getOwnedAgentStep: vi.fn(),
}));
vi.mock("@/server/ai-generation/start", () => ({ startAiJobForUser: vi.fn() }));

const { runStudyCoach } = await import("@/server/agent/runtime");
const { beginAgentTurn, getOwnedAgentStep } = await import("@/server/agent/store");
const { startAiJobForUser } = await import("@/server/ai-generation/start");

const post = (path: string, body: unknown) =>
  new Request(`https://ankify.test${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

afterEach(() => vi.unstubAllEnvs());

describe("suspended legacy workflows", () => {
  it("refuse card and quiz generation with a structured 410, starting no job", async () => {
    for (const body of [
      { action: "card_generate", problemId: "p1", requestId: crypto.randomUUID() },
      { action: "quiz_generate", problemId: "p1", requestId: crypto.randomUUID(), expectedQuizSessionId: null },
    ]) {
      const response = await createAiJob(post("/api/ai-jobs", body));
      expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({ error: "workflow_suspended", workflow: body.action === "card_generate" ? "card_generation" : "quiz_generation" });
    }
    expect(startAiJobForUser).not.toHaveBeenCalled();
  });

  it("refuse Study Coach turns and stale proposal approvals, running no model", async () => {
    const turn = await agentTurn(post("/api/agent/turns", { message: "help" }));
    expect(turn.status).toBe(410);
    expect(await turn.json()).toMatchObject({ error: "workflow_suspended", workflow: "coach" });
    const approval = await approveStep(post("/api/agent/steps/s1/approve", {}), { params: Promise.resolve({ id: "s1" }) });
    expect(approval.status).toBe(410);
    expect(beginAgentTurn).not.toHaveBeenCalled();
    expect(runStudyCoach).not.toHaveBeenCalled();
    expect(getOwnedAgentStep).not.toHaveBeenCalled();
    expect(startAiJobForUser).not.toHaveBeenCalled();
  });

  it("still serve them when an operator re-enables them explicitly", async () => {
    vi.stubEnv("ANKIFY_ENABLED_LEGACY_WORKFLOWS", "card_generation");
    vi.mocked(startAiJobForUser).mockResolvedValueOnce({ id: "j1", status: "queued" } as never);
    const response = await createAiJob(post("/api/ai-jobs", { action: "card_generate", problemId: "p1", requestId: crypto.randomUUID() }));
    expect(response.status).not.toBe(410);
    expect(startAiJobForUser).toHaveBeenCalledOnce();
  });
});

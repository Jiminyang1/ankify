import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@ankify/db";
import type { AiRuntimeSettings } from "../settings";
import { getStarterAiStatus } from "../starter-ai";
import { createTestDb } from "../test-db";
import { AgentRequestError, beginAgentTurn, failAgentRun } from "./store";

const testDb = createTestDb();
process.env.ANKIFY_STARTER_AI_API_KEY = "sk-starter-test";
process.env.ANKIFY_STARTER_AI_CREDITS = "10";

const USER_ID = "user-coach";
const context = { page: "today" as const, activePanel: "overview" as const, problemId: null };

const starterSettings: AiRuntimeSettings = {
  provider: "deepseek",
  model: "deepseek-v4-flash",
  reasoningMode: "fast",
  apiKey: "sk-starter-test",
  source: "starter",
  starterLimit: 10,
};
const ownKeySettings: AiRuntimeSettings = { ...starterSettings, apiKey: "sk-own", source: "user", starterLimit: undefined };

function begin(settings = starterSettings, overrides: { sessionId?: string | null; requestId?: string } = {}) {
  return beginAgentTurn({
    userId: USER_ID,
    sessionId: overrides.sessionId ?? null,
    requestId: overrides.requestId ?? randomUUID(),
    message: "Why did my attempt fail?",
    context,
    settings,
  });
}

async function starterRemaining() {
  return (await getStarterAiStatus(USER_ID)).remaining;
}

beforeAll(async () => {
  await testDb.migrate();
  await getDb().insert(schema.user).values({ id: USER_ID, name: "Test", email: "coach@example.com" });
});

beforeEach(async () => {
  const db = getDb();
  await db.delete(schema.agentSessions);
  await db.delete(schema.aiCreditLedger);
  await db.delete(schema.settings);
});

afterAll(() => testDb.cleanup());

describe("Study Coach credits", () => {
  it("spends one credit per turn, tied to the run", async () => {
    const started = await begin();
    // A Study Coach turn costs 5 credits.
    expect(await starterRemaining()).toBe(5);
    const [spend] = await getDb().select().from(schema.aiCreditLedger);
    expect(spend).toMatchObject({ reason: "spend", refType: "agent_run", refId: started.run.id });
  });

  it("does not spend for the user's own key", async () => {
    await begin(ownKeySettings);
    expect(await getDb().select().from(schema.aiCreditLedger)).toHaveLength(0);
  });

  it("rolls back the whole turn when credits are exhausted", async () => {
    // 4 free credits cannot cover a 5-credit turn.
    const error = await begin({ ...starterSettings, starterLimit: 4 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentRequestError);
    expect(error).toMatchObject({ code: "starter_credits_exhausted", status: 403 });
    expect(await getDb().select().from(schema.agentSessions)).toHaveLength(0);
    expect(await getDb().select().from(schema.agentRuns)).toHaveLength(0);
  });

  it("does not spend for invalid, duplicate, or busy requests", async () => {
    await expect(begin(starterSettings, { sessionId: "missing" })).rejects.toMatchObject({ code: "session_not_found" });

    const requestId = randomUUID();
    const first = await begin(starterSettings, { requestId });
    await expect(begin(starterSettings, { requestId })).rejects.toMatchObject({ code: "request_already_used" });
    await expect(begin(starterSettings, { sessionId: first.session.id })).rejects.toMatchObject({ code: "agent_busy" });

    expect(await getDb().select().from(schema.aiCreditLedger)).toHaveLength(1);
    expect(await starterRemaining()).toBe(5);
  });

  it("refunds a provider failure once, but not a user interruption", async () => {
    const failed = await begin();
    await failAgentRun({ userId: USER_ID, runId: failed.run.id, code: "provider_unavailable", message: "x" });
    expect(await starterRemaining()).toBe(10);
    await expect(
      failAgentRun({ userId: USER_ID, runId: failed.run.id, code: "provider_unavailable", message: "x" }),
    ).rejects.toThrow("agent_run_not_running");
    expect(await starterRemaining()).toBe(10);

    const interrupted = await begin();
    await failAgentRun({ userId: USER_ID, runId: interrupted.run.id, code: "agent_interrupted", message: "x" });
    expect(await starterRemaining()).toBe(5);
    const [run] = await getDb().select().from(schema.agentRuns).where(eq(schema.agentRuns.id, interrupted.run.id));
    expect(run?.status).toBe("failed");
  });
});

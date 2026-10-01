import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@ankify/db";
import { setAiSettings } from "../settings";
import { getStarterAiStatus } from "../starter-ai";
import { createTestDb } from "../test-db";
import { generateAiCardDraft } from "./card";
import { dispatchAiJob } from "./dispatch";
import {
  AiJobRequestError,
  cancelOwnedAiJob,
  claimAiJob,
  createAiJob,
  failAiJob,
  failQueuedAiJob,
} from "./jobs";
import { processAiJob } from "./runner";
import { startAiJobForUser } from "./start";

// Provider calls and queue publishing are the only mocks; every assertion
// below reads the real database state.
vi.mock("./dispatch", () => ({ dispatchAiJob: vi.fn(async () => undefined) }));
vi.mock("./card", () => ({ generateAiCardDraft: vi.fn() }));

const testDb = createTestDb();
process.env.AI_KEY_ENCRYPTION_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.ANKIFY_STARTER_AI_API_KEY = "sk-starter-test";
process.env.ANKIFY_STARTER_AI_CREDITS = "2";

const USER_ID = "user-jobs";
const PROBLEM_ID = "problem-jobs";
const draft = { question: "Q?", answer: "A." };

function cardJobInput(requestId = randomUUID()) {
  return { action: "card_generate" as const, problemId: PROBLEM_ID, requestId };
}

async function ledger(reason?: "spend" | "refund") {
  const rows = await getDb().select().from(schema.aiCreditLedger);
  return reason ? rows.filter((row) => row.reason === reason) : rows;
}

async function starterRemaining() {
  return (await getStarterAiStatus(USER_ID)).remaining;
}

async function jobRow(id: string) {
  const [row] = await getDb().select().from(schema.aiJobs).where(eq(schema.aiJobs.id, id));
  return row!;
}

beforeAll(async () => {
  await testDb.migrate();
  await getDb().insert(schema.user).values({ id: USER_ID, name: "Test", email: "jobs@example.com" });
  await getDb().insert(schema.problems).values({
    id: PROBLEM_ID,
    userId: USER_ID,
    leetcodeSlug: "two-sum",
    title: "Two Sum",
    difficulty: "Easy",
    url: "https://leetcode.com/problems/two-sum/",
  });
});

beforeEach(async () => {
  const db = getDb();
  await db.delete(schema.aiJobs);
  await db.delete(schema.cards);
  await db.delete(schema.aiCreditLedger);
  await db.delete(schema.settings);
  vi.mocked(dispatchAiJob).mockReset().mockResolvedValue(undefined);
  vi.mocked(generateAiCardDraft).mockReset().mockResolvedValue(draft);
  await testDb.exec("DROP TRIGGER IF EXISTS fail_refund_insert");
  // Card generation is suspended by default (Phase 6B); these tests cover its
  // still-present accounting, so they re-enable it as an operator would.
  vi.stubEnv("ANKIFY_ENABLED_LEGACY_WORKFLOWS", "card_generation,quiz_generation");
});
afterEach(() => vi.unstubAllEnvs());

afterAll(() => testDb.cleanup());

describe("AI job creation", () => {
  it("spends one hosted credit per new job, tied to that job", async () => {
    const job = await createAiJob(USER_ID, cardJobInput());
    expect(job.status).toBe("queued");
    expect(await starterRemaining()).toBe(1);
    const spends = await ledger("spend");
    expect(spends).toMatchObject([{ refType: "ai_job", refId: job.id, bucket: "starter", delta: -1 }]);
  });

  it("returns the existing job for a repeated request id without spending again", async () => {
    const input = cardJobInput();
    const first = await createAiJob(USER_ID, input);
    const again = await createAiJob(USER_ID, input);
    expect(again.id).toBe(first.id);
    expect(await ledger("spend")).toHaveLength(1);
  });

  it("rejects a second active job for the same slot without spending", async () => {
    await createAiJob(USER_ID, cardJobInput());
    await expect(createAiJob(USER_ID, cardJobInput())).rejects.toMatchObject({ code: "ai_job_conflict" });
    expect(await ledger("spend")).toHaveLength(1);
    expect(await starterRemaining()).toBe(1);
  });

  it("spends nothing when the insert loses a dedup race (simulated)", async () => {
    // Simulates another request inserting into the same slot after the
    // application-level check: the pre-check only sees active rows, so this
    // row is found only by the unique index during insert.
    await getDb().insert(schema.aiJobs).values({
      id: "racer",
      userId: USER_ID,
      problemId: PROBLEM_ID,
      kind: "card",
      action: "card_generate",
      status: "failed",
      idempotencyKey: randomUUID(),
      activeDedupKey: `card-generate:${PROBLEM_ID}`,
      inputEnvelope: { v: 1, iv: "x", ciphertext: "x" },
      provider: "deepseek",
      model: "m",
      reasoningMode: "fast",
      generationLanguage: "en",
    });
    await expect(createAiJob(USER_ID, cardJobInput())).rejects.toMatchObject({ code: "ai_job_conflict" });
    expect(await ledger("spend")).toHaveLength(0);
    expect(await starterRemaining()).toBe(2);
  });

  it("creates no job when credits are exhausted", async () => {
    process.env.ANKIFY_STARTER_AI_CREDITS = "0";
    try {
      const error = await createAiJob(USER_ID, cardJobInput()).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AiJobRequestError);
      expect(error).toMatchObject({ code: "starter_credits_exhausted", status: 403 });
      expect(await getDb().select().from(schema.aiJobs)).toHaveLength(0);
    } finally {
      process.env.ANKIFY_STARTER_AI_CREDITS = "2";
    }
  });

  it("never spends hosted credits for a user's own key", async () => {
    await setAiSettings(USER_ID, { provider: "openai", model: "gpt-test", apiKey: "sk-own" });
    const job = await createAiJob(USER_ID, cardJobInput());
    expect(job.provider).toBe("openai");
    expect(await ledger()).toHaveLength(0);
    // Failing an own-key job has nothing to refund.
    await failQueuedAiJob(job.id, "queue_publish_failed", "x");
    expect(await ledger()).toHaveLength(0);
    expect(await starterRemaining()).toBe(2);
  });

  it("refunds when publishing to the queue fails", async () => {
    vi.mocked(dispatchAiJob).mockRejectedValueOnce(new Error("queue down"));
    await expect(startAiJobForUser(USER_ID, cardJobInput())).rejects.toMatchObject({
      code: "queue_publish_failed",
      status: 503,
    });
    const [job] = await getDb().select().from(schema.aiJobs);
    expect(job?.status).toBe("failed");
    expect(await ledger("refund")).toHaveLength(1);
    expect(await starterRemaining()).toBe(2);
  });
});

describe("AI job terminal transitions", () => {
  it("refunds a failed queued job exactly once", async () => {
    const job = await createAiJob(USER_ID, cardJobInput());
    await failQueuedAiJob(job.id, "x", "x");
    await failQueuedAiJob(job.id, "x", "x");
    expect(await ledger("refund")).toHaveLength(1);
    expect(await starterRemaining()).toBe(2);
  });

  it("refunds a job cancelled before it started, but not one cancelled after", async () => {
    const early = await createAiJob(USER_ID, cardJobInput());
    await cancelOwnedAiJob(USER_ID, early.id);
    expect(await starterRemaining()).toBe(2);

    const late = await createAiJob(USER_ID, cardJobInput());
    const claim = await claimAiJob(late.id, "worker-1");
    expect(claim?.state).toBe("claimed");
    await cancelOwnedAiJob(USER_ID, late.id);
    expect((await jobRow(late.id)).status).toBe("cancelled");
    expect(await starterRemaining()).toBe(1);
  });

  it("refunds when the worker fails with a non-retryable error", async () => {
    const job = await createAiJob(USER_ID, cardJobInput());
    vi.mocked(generateAiCardDraft).mockRejectedValueOnce(Object.assign(new Error("rejected"), { status: 400 }));
    expect(await processAiJob(job.id, "worker-1")).toEqual({ state: "done" });
    expect((await jobRow(job.id)).status).toBe("failed");
    expect(await starterRemaining()).toBe(2);

    // A late duplicate failure for the same job cannot refund twice.
    await failAiJob({ ...(await jobRow(job.id)), workerId: "worker-1" }, "x", "x");
    expect(await ledger("refund")).toHaveLength(1);
  });

  it("keeps the credit while retrying and refunds once retries are exhausted", async () => {
    const job = await createAiJob(USER_ID, cardJobInput());
    vi.mocked(generateAiCardDraft).mockRejectedValue(new Error("provider hiccup"));
    const result = await processAiJob(job.id, "worker-1");
    expect(result.state).toBe("retry");
    expect((await jobRow(job.id)).status).toBe("queued");
    expect(await starterRemaining()).toBe(1);

    await getDb()
      .update(schema.aiJobs)
      .set({ attempt: 3, runAfter: new Date(0) })
      .where(eq(schema.aiJobs.id, job.id));
    const claim = await claimAiJob(job.id, "worker-2");
    expect(claim?.state).toBe("terminal");
    expect((await jobRow(job.id)).errorCode).toBe("attempts_exhausted");
    expect(await starterRemaining()).toBe(2);
  });

  it("keeps the credit for a successful job", async () => {
    const job = await createAiJob(USER_ID, cardJobInput());
    await processAiJob(job.id, "worker-1");
    expect((await jobRow(job.id)).status).toBe("succeeded");
    expect(await ledger("refund")).toHaveLength(0);
    expect(await starterRemaining()).toBe(1);
  });

  it("refunds a superseded follow-up whose card changed during generation", async () => {
    await getDb().insert(schema.cards).values({
      id: "card-1",
      userId: USER_ID,
      problemId: PROBLEM_ID,
      question: "old",
      answer: "old",
      aiStatus: "candidate",
    });
    const [card] = await getDb().select().from(schema.cards).where(eq(schema.cards.id, "card-1"));
    const job = await createAiJob(USER_ID, {
      action: "card_followup",
      problemId: PROBLEM_ID,
      requestId: randomUUID(),
      cardId: "card-1",
      expectedCardVersion: card!.version,
      draft,
      instruction: "shorter",
    });
    vi.mocked(generateAiCardDraft).mockImplementationOnce(async () => {
      await getDb()
        .update(schema.cards)
        .set({ version: card!.version + 1 })
        .where(and(eq(schema.cards.id, "card-1"), eq(schema.cards.userId, USER_ID)));
      return draft;
    });
    await processAiJob(job.id, "worker-1");
    expect((await jobRow(job.id)).status).toBe("superseded");
    expect(await starterRemaining()).toBe(2);
  });

  it("does not refund or commit when cancellation races a running generation", async () => {
    const job = await createAiJob(USER_ID, cardJobInput());
    vi.mocked(generateAiCardDraft).mockImplementationOnce(async () => {
      await cancelOwnedAiJob(USER_ID, job.id);
      return draft;
    });
    await processAiJob(job.id, "worker-1");
    expect((await jobRow(job.id)).status).toBe("cancelled");
    expect(await getDb().select().from(schema.cards)).toHaveLength(0);
    expect(await starterRemaining()).toBe(1);
  });

  it("still fails the job when its refund write fails, leaving it detectable for reconciliation", async () => {
    const job = await createAiJob(USER_ID, cardJobInput());
    await testDb.exec(
      "CREATE TRIGGER fail_refund_insert BEFORE INSERT ON ai_credit_ledger WHEN NEW.reason = 'refund' BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
    );
    await failQueuedAiJob(job.id, "x", "x");
    expect((await jobRow(job.id)).status).toBe("failed");
    expect(await starterRemaining()).toBe(1);

    // Same query as docs/PAID_AI_CREDITS.md "Reconciliation".
    const unrefunded = await getDb().all<{ ref_id: string }>(sql`
      SELECT l.ref_id FROM ai_credit_ledger l
      LEFT JOIN ai_credit_ledger r ON r.reason = 'refund' AND r.ref_type = l.ref_type AND r.ref_id = l.ref_id
      LEFT JOIN ai_jobs j ON l.ref_type = 'ai_job' AND j.id = l.ref_id
      LEFT JOIN agent_runs a ON l.ref_type = 'agent_run' AND a.id = l.ref_id
      WHERE l.reason = 'spend' AND r.id IS NULL AND (
        j.status IN ('failed', 'superseded')
        OR (j.status = 'cancelled' AND j.started_at IS NULL)
        OR (a.status = 'failed' AND a.error_code <> 'agent_interrupted'))`);
    expect(unrefunded.map((row) => row.ref_id)).toEqual([job.id]);
  });
});

describe("suspended card and quiz generation", () => {
  it("refuses new jobs without spending anything", async () => {
    vi.unstubAllEnvs();
    await expect(startAiJobForUser(USER_ID, cardJobInput())).rejects.toMatchObject({ code: "workflow_suspended", status: 410 });
    expect(await getDb().select().from(schema.aiJobs)).toEqual([]);
    expect(await ledger("spend")).toEqual([]);
  });

  it("fails a job queued before the suspension without a provider call, refunding it once", async () => {
    const job = await createAiJob(USER_ID, cardJobInput());
    expect(await ledger("spend")).toHaveLength(1);
    vi.unstubAllEnvs();
    expect(await processAiJob(job.id, "worker-1")).toEqual({ state: "done" });
    expect(await processAiJob(job.id, "worker-2")).toEqual({ state: "done" });
    const [row] = await getDb().select().from(schema.aiJobs).where(eq(schema.aiJobs.id, job.id));
    expect(row).toMatchObject({ status: "failed", errorCode: "workflow_suspended" });
    expect(generateAiCardDraft).not.toHaveBeenCalled();
    expect(await ledger("refund")).toHaveLength(1);
  });
});

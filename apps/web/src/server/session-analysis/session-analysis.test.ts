import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { getDb, schema } from "@ankify/db";
import { and, eq } from "drizzle-orm";
import { buildModel } from "../ai";
import { dispatchAiJob } from "../ai-generation/dispatch";
import { iterateAccountExport } from "../account-export";
import { AiJobRequestError, cancelOwnedAiJob, claimAiJob, decryptJobInput } from "../ai-generation/jobs";
import { processAiJob } from "../ai-generation/runner";
import { startAiJobForUser } from "../ai-generation/start";
import { loadMistakeProfile } from "../mistake-profile";
import { updateMistake } from "../mistakes";
import { ingestSessionObservations, runSessionCommand, startPracticeSession } from "../practice-sessions/commands";
import { setAiSettings, setAnalysisSettings } from "../settings";
import { createTestDb } from "../test-db";
import { analysesUsedToday, AUTOMATIC_ANALYSIS_DELAY_MS, loadAutomaticAnalysisContext, planAutomaticAnalysis, redispatchStrandedJobs } from "./jobs";
import { getSessionAnalysisState } from "./queries";
import { runSessionAnalysisJob } from "./run";

// Provider calls and queue publishing are the only mocks; every assertion
// reads the real database.
vi.mock("../ai-generation/dispatch", () => ({ dispatchAiJob: vi.fn(async () => undefined) }));
vi.mock("../ai", async (importOriginal) => ({ ...(await importOriginal<typeof import("../ai")>()), buildModel: vi.fn() }));

process.env.AI_KEY_ENCRYPTION_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
// A hosted key with the same provider and model as the user's own: analysis
// must never run on it.
process.env.ANKIFY_STARTER_AI_API_KEY = "sk-hosted";
process.env.ANKIFY_STARTER_AI_PROVIDER = "openai";
process.env.ANKIFY_STARTER_AI_MODEL = "gpt-test";

const testDb = createTestDb();
const USER = "analysis-owner";
const OTHER = "analysis-other";
const TAB = "aaaaaaaa-0000-4000-8000-00000000000a";
const MIN = 60_000;
const uuid = () => crypto.randomUUID();

const FINDINGS = {
  summary: "The sum skipped the first element.",
  insufficientEvidence: false,
  findings: [
    {
      category: "edge_case",
      cause: "The loop started at index 1.",
      nextStep: "Check the first and last index.",
      confidence: "high",
      evidence: [
        { attempt: "S1", startLine: 2, endLine: 2 },
        { attempt: "S2", startLine: null, endLine: null },
      ],
    },
  ],
};

const reply = (output: unknown) => ({
  content: [{ type: "text" as const, text: typeof output === "string" ? output : JSON.stringify(output) }],
  finishReason: { unified: "stop" as const, raw: "stop" },
  usage: {
    inputTokens: { total: 1_200, noCache: 1_200, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 90, text: 90, reasoning: 0 },
  },
  warnings: [],
});

let provider: MockLanguageModelV4;
function useModel(...outputs: unknown[]) {
  let call = 0;
  provider = new MockLanguageModelV4({
    provider: "openai",
    modelId: "gpt-test",
    doGenerate: async () => {
      const next = outputs[Math.min(call, outputs.length - 1)];
      call += 1;
      if (next instanceof Error) throw next;
      return reply(next);
    },
  });
  vi.mocked(buildModel).mockReturnValue(provider);
}

let problemCounter = 0;
async function session(
  verdicts: string[],
  options: { userId?: string; codes?: (string | null)[]; finish?: boolean; topics?: string[]; reviewOf?: string } = {},
) {
  problemCounter += 1;
  const userId = options.userId ?? USER;
  const start = new Date(Date.now() - 90 * MIN);
  const started = await startPracticeSession(
    userId,
    {
      requestId: uuid(),
      // `reviewOf`: an early review of a problem already in the deck.
      target: options.reviewOf ? { kind: "problem", problemId: options.reviewOf } : {
        kind: "leetcode",
        problem: {
          leetcodeSlug: `analysis-${problemCounter}`,
          leetcodeId: 5_000 + problemCounter,
          title: `Analysis ${problemCounter}`,
          difficulty: "Medium",
          url: `https://leetcode.com/problems/analysis-${problemCounter}/`,
          topicTags: options.topics ?? ["Array"],
          similarSlugs: [],
        },
      },
      mode: options.reviewOf ? "early_review" : "practice",
      ownerToken: TAB,
      baseline: { state: "none" },
      supersedePendingRating: false,
    },
    start,
  );
  if (!started.ok) throw new Error(started.error);
  const id = started.response.session.id;
  const observed = await ingestSessionObservations(
    userId,
    id,
    {
      observations: verdicts.map((verdict, index) => {
        const code = options.codes ? options.codes[index] : `def solve(nums):\n    return sum(nums[${index}:])\n`;
        return {
          leetcodeSubmissionId: String(900_000 + problemCounter * 100 + index),
          verdict: verdict as "Accepted",
          submittedAt: new Date(start.getTime() + (index + 1) * MIN).toISOString(),
          ...(code == null
            ? { detailUnavailable: true }
            : { detail: { language: "python3", code, ...(verdict === "Accepted" ? {} : { failedTestcase: "[1,2]", expectedOutput: "3", actualOutput: "2" }) } }),
        };
      }),
    },
    new Date(start.getTime() + 20 * MIN),
  );
  if (!observed.ok) throw new Error(observed.error);
  if (options.finish !== false) {
    const finished = await runSessionCommand(
      userId,
      id,
      { type: "finish", requestId: uuid(), ownerToken: TAB, result: verdicts.includes("Accepted") ? "solved" : "unsuccessful", occurredAt: new Date(start.getTime() + 25 * MIN).toISOString() },
      new Date(start.getTime() + 25 * MIN),
    );
    if (!finished.ok) throw new Error(finished.error);
  }
  return { sessionId: id, problemId: started.response.problem.id };
}

const analyze = (practiceSessionId: string, requestId = uuid(), userId = USER) =>
  startAiJobForUser(userId, { action: "session_analyze", practiceSessionId, requestId });

async function requestError(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AiJobRequestError) return { status: error.status, code: error.code };
    throw error;
  }
  throw new Error("expected a request error");
}

const job = async (id: string) => (await getDb().select().from(schema.aiJobs).where(eq(schema.aiJobs.id, id)))[0]!;
const jobsOf = (userId = USER) => getDb().select().from(schema.aiJobs).where(eq(schema.aiJobs.userId, userId));
const analyses = () => getDb().select().from(schema.sessionAnalyses);
const candidates = (sessionId: string) =>
  getDb()
    .select()
    .from(schema.mistakeRecords)
    .where(and(eq(schema.mistakeRecords.practiceSessionId, sessionId), eq(schema.mistakeRecords.origin, "ai_suggested")));
const todayStart = () => new Date(new Date().setUTCHours(0, 0, 0, 0));

beforeAll(() => testDb.migrate());
beforeEach(async () => {
  await getDb().delete(schema.user);
  await getDb().insert(schema.user).values([
    { id: USER, name: "Owner", email: "analysis@example.test" },
    { id: OTHER, name: "Other", email: "analysis-other@example.test" },
  ]);
  await setAiSettings(USER, { provider: "openai", model: "gpt-test", apiKey: "sk-user" });
  // Automatic analysis is on by default; only its own tests turn it on here.
  vi.stubEnv("ANKIFY_AUTOMATIC_ANALYSIS", "disabled");
  vi.mocked(dispatchAiJob).mockReset().mockResolvedValue(undefined);
  vi.mocked(buildModel).mockReset();
  useModel(FINDINGS);
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => testDb.cleanup());

describe("manual analysis", () => {
  it("commits one analysis and its candidate findings from the user's own key", async () => {
    const { sessionId, problemId } = await session(["Wrong Answer", "Wrong Answer", "Accepted"]);
    const created = await analyze(sessionId);
    expect(created).toMatchObject({ status: "queued", kind: "analysis", action: "session_analyze", trigger: "manual", practiceSessionId: sessionId, problemId });
    expect(dispatchAiJob).toHaveBeenCalledWith(created.id);
    expect((await job(created.id)).dispatchedAt).not.toBeNull();

    await processAiJob(created.id, "worker-1");
    expect(provider.doGenerateCalls).toHaveLength(1);
    expect(provider.doGenerateCalls[0]!.maxOutputTokens).toBe(2_000);
    expect(vi.mocked(buildModel).mock.calls[0]![0]).toMatchObject({ apiKey: "sk-user", source: "user" });

    const state = (await getSessionAnalysisState(USER, sessionId))!;
    expect(state.job).toMatchObject({ id: created.id, status: "succeeded", resultAnalysisId: state.analysis!.id });
    expect(state.analysis).toMatchObject({
      stale: false,
      provider: "openai",
      model: "gpt-test",
      usage: { inputTokens: 1_200, outputTokens: 90 },
      coverage: { attempts: 3, attemptsWithCode: 3, revisions: 3 },
      result: { summary: "The sum skipped the first element.", findings: [{ mistakeId: `ai_${created.id}_edge_case`, category: "edge_case", confidence: "high" }] },
    });
    expect(state.analysis!.coverage.inputChars).toBeLessThanOrEqual(32_000);
    expect(state.findings).toMatchObject([
      {
        primaryCategory: "edge_case",
        status: "candidate",
        origin: "ai_suggested",
        sourceType: "practice_session",
        summary: "The loop started at index 1.",
        nextStep: "Check the first and last index.",
        evidence: [{ kind: "code_range", startLine: 2, endLine: 2 }, { kind: "observation" }],
      },
    ]);
    expect(state.manual).toEqual({ available: true });
    const exported: { type: string; data: unknown }[] = [];
    for await (const row of iterateAccountExport({ id: USER, name: "Owner", email: "analysis@example.test", image: null })) exported.push(row);
    expect(exported.filter((row) => row.type === "session_analysis")).toMatchObject([{ data: { id: state.analysis!.id, practiceSessionId: sessionId } }]);

    // A candidate is listed apart and weighs nothing until the user confirms it.
    let profile = await loadMistakeProfile(USER);
    expect(profile.candidates).toMatchObject([{ category: "edge_case", practiceSessionId: sessionId }]);
    expect(profile.categories).toEqual([]);
    expect(state.findings[0]).toMatchObject({ status: "candidate", origin: "ai_suggested", suggestedCategory: "edge_case" });
    const corrected = await updateMistake(USER, state.findings[0]!.id, { status: "confirmed", primaryCategory: "implementation" });
    // The correction is kept apart from the suggestion: confirmed as implementation, suggested as edge case.
    expect(corrected).toMatchObject({ ok: true, mistake: { status: "confirmed", primaryCategory: "implementation", suggestedCategory: "edge_case" } });
    profile = await loadMistakeProfile(USER);
    expect(profile.candidates).toEqual([]);
    expect(profile.categories).toMatchObject([{ category: "implementation", contexts: 1 }]);
    expect(profile.categories.find((item) => item.category === "edge_case")).toBeUndefined();
  });

  it("replays a request id, rejects it for another session, and runs one analysis per session at a time", async () => {
    const first = await session(["Wrong Answer", "Accepted"]);
    const second = await session(["Wrong Answer", "Accepted"]);
    const requestId = uuid();
    const created = await analyze(first.sessionId, requestId);
    expect((await analyze(first.sessionId, requestId)).id).toBe(created.id);
    expect(await requestError(analyze(second.sessionId, requestId))).toEqual({ status: 409, code: "ai_job_request_conflict" });
    expect(await requestError(analyze(first.sessionId))).toEqual({ status: 409, code: "ai_job_conflict" });
    expect(await jobsOf()).toHaveLength(1);
  });

  it("answers unchanged evidence from the cache without a provider call or budget", async () => {
    const { sessionId } = await session(["Wrong Answer", "Accepted"]);
    const first = await analyze(sessionId);
    await processAiJob(first.id, "worker-1");
    const again = await analyze(sessionId);
    expect(again).toMatchObject({ status: "succeeded", attempt: 0, resultAnalysisId: (await job(first.id)).resultAnalysisId });
    expect(dispatchAiJob).toHaveBeenCalledTimes(1);
    expect(provider.doGenerateCalls).toHaveLength(1);
    expect(await analysesUsedToday(getDb(), USER, "manual", todayStart())).toBe(1);
  });

  it("marks an analysis stale when evidence arrives later; a new analysis replaces open suggestions and never duplicates a confirmed one", async () => {
    const { sessionId } = await session(["Wrong Answer", "Accepted"]);
    const first = await analyze(sessionId);
    await processAiJob(first.id, "worker-1");
    const more = (offset: number) =>
      ingestSessionObservations(USER, sessionId, {
        observations: [{ leetcodeSubmissionId: String(900_000 + problemCounter * 100 + offset), verdict: "Accepted", submittedAt: new Date(Date.now() - 70 * MIN).toISOString(), detail: { language: "python3", code: `def solve(nums):\n    return sum(nums) + ${offset}\n` } }],
      });
    await more(50);
    expect((await getSessionAnalysisState(USER, sessionId))!.analysis!.stale).toBe(true);

    // The open suggestion from the first analysis is replaced, not kept beside the new one.
    const second = await analyze(sessionId);
    expect(second.status).toBe("queued");
    await processAiJob(second.id, "worker-2");
    const state = (await getSessionAnalysisState(USER, sessionId))!;
    expect(state.analysis).toMatchObject({ id: `sa_${second.id}`, stale: false, result: { findings: [{ category: "edge_case", mistakeId: `ai_${second.id}_edge_case` }] } });
    expect(await analyses()).toHaveLength(2);
    expect((await candidates(sessionId)).map((row) => row.id)).toEqual([`ai_${second.id}_edge_case`]);

    // Once confirmed, a later analysis finding the same cause adds nothing.
    await updateMistake(USER, `ai_${second.id}_edge_case`, { status: "confirmed" });
    await more(51);
    const third = await analyze(sessionId);
    await processAiJob(third.id, "worker-3");
    expect((await getSessionAnalysisState(USER, sessionId))!.analysis).toMatchObject({ result: { findings: [{ category: "edge_case", mistakeId: null }] } });
    expect((await candidates(sessionId)).map((row) => [row.id, row.status])).toEqual([[`ai_${second.id}_edge_case`, "confirmed"]]);
  });

  it("ignores repeated deliveries after the commit", async () => {
    const { sessionId } = await session(["Wrong Answer", "Accepted"]);
    const created = await analyze(sessionId);
    await processAiJob(created.id, "delivery-1");
    await processAiJob(created.id, "delivery-2");
    await processAiJob(created.id, "delivery-3");
    expect(provider.doGenerateCalls).toHaveLength(1);
    expect(await analyses()).toHaveLength(1);
    expect(await candidates(sessionId)).toHaveLength(1);
  });

  it("lets only the current lease holder commit after a lease expires", async () => {
    const { sessionId } = await session(["Wrong Answer", "Accepted"]);
    const created = await analyze(sessionId);
    const claim = await claimAiJob(created.id, "worker-a");
    expect(claim?.state).toBe("claimed");
    const stale = claim!.job;
    await getDb().update(schema.aiJobs).set({ leaseExpiresAt: new Date(Date.now() - 1_000) }).where(eq(schema.aiJobs.id, created.id));

    await processAiJob(created.id, "worker-b");
    expect(await job(created.id)).toMatchObject({ status: "succeeded", attempt: 2 });
    // The first worker finishes late: its commit is refused.
    await runSessionAnalysisJob(stale, decryptJobInput(stale) as { action: "session_analyze"; practiceSessionId: string; requestId: string });
    expect(await analyses()).toHaveLength(1);
    expect(await candidates(sessionId)).toHaveLength(1);
  });

  it("requires the user's own key, and a removed key fails the job without using the hosted key", async () => {
    const theirs = await session(["Wrong Answer", "Accepted"], { userId: OTHER });
    expect(await requestError(analyze(theirs.sessionId, uuid(), OTHER))).toEqual({ status: 403, code: "own_key_required" });
    expect(await jobsOf(OTHER)).toEqual([]);

    const { sessionId } = await session(["Wrong Answer", "Accepted"]);
    const created = await analyze(sessionId);
    await setAiSettings(USER, { provider: "openai", model: "gpt-test", apiKey: "" });
    await processAiJob(created.id, "worker-1");
    expect(await job(created.id)).toMatchObject({ status: "failed", errorCode: "own_key_required" });
    expect(buildModel).not.toHaveBeenCalled();
    expect(provider.doGenerateCalls).toHaveLength(0);
    expect(await getDb().select().from(schema.aiCreditLedger)).toEqual([]);
  });

  it("stops queued work without a provider call once the operator switches analysis off", async () => {
    const { sessionId } = await session(["Wrong Answer", "Accepted"]);
    const created = await analyze(sessionId);
    vi.stubEnv("ANKIFY_DISABLED_WORKFLOWS", "session_analysis");
    expect(await requestError(analyze(sessionId))).toEqual({ status: 503, code: "workflow_disabled" });
    await processAiJob(created.id, "worker-1");
    expect(await job(created.id)).toMatchObject({ status: "failed", errorCode: "workflow_disabled" });
    expect(provider.doGenerateCalls).toHaveLength(0);
    expect(await analyses()).toEqual([]);
    expect(await candidates(sessionId)).toEqual([]);
  });

  it("fails a job whose provider or model changed after it was queued", async () => {
    const { sessionId } = await session(["Wrong Answer", "Accepted"]);
    const created = await analyze(sessionId);
    await setAiSettings(USER, { provider: "openai", model: "gpt-other", apiKey: "sk-user" });
    await processAiJob(created.id, "worker-1");
    expect(await job(created.id)).toMatchObject({ status: "failed", errorCode: "ai_configuration_changed" });
    expect(provider.doGenerateCalls).toHaveLength(0);
  });

  it("refuses open sessions, sessions without code, and other users' sessions", async () => {
    const open = await session(["Wrong Answer"], { finish: false });
    expect(await requestError(analyze(open.sessionId))).toEqual({ status: 409, code: "session_not_completed" });
    const noCode = await session(["Wrong Answer", "Accepted"], { codes: [null, null] });
    expect(await requestError(analyze(noCode.sessionId))).toEqual({ status: 409, code: "insufficient_evidence" });
    expect((await getSessionAnalysisState(USER, noCode.sessionId))!.manual).toEqual({ available: false, reason: "insufficient_evidence" });
    const theirs = await session(["Wrong Answer", "Accepted"], { userId: OTHER });
    expect(await requestError(analyze(theirs.sessionId))).toEqual({ status: 404, code: "session_not_found" });
    expect(await getSessionAnalysisState(USER, theirs.sessionId)).toBeNull();
    expect(await jobsOf()).toEqual([]);
  });

  it("fails output that does not match the schema once, without a retry or repair", async () => {
    useModel({ summary: 5, findings: "none" });
    const { sessionId } = await session(["Wrong Answer", "Accepted"]);
    const created = await analyze(sessionId);
    await processAiJob(created.id, "worker-1");
    expect(await job(created.id)).toMatchObject({ status: "failed", errorCode: "ai_output_invalid", attempt: 1 });
    expect(provider.doGenerateCalls).toHaveLength(1);
    expect(await analyses()).toEqual([]);
  });

  it("retries a provider outage for at most three provider attempts", async () => {
    useModel(new APICallError({ message: "overloaded", url: "https://api.test", requestBodyValues: {}, statusCode: 503, isRetryable: true }));
    const { sessionId } = await session(["Wrong Answer", "Accepted"]);
    const created = await analyze(sessionId);
    for (let delivery = 1; delivery <= 4; delivery += 1) {
      await processAiJob(created.id, `delivery-${delivery}`);
      await getDb().update(schema.aiJobs).set({ runAfter: new Date(Date.now() - 1_000) }).where(eq(schema.aiJobs.id, created.id));
    }
    expect(await job(created.id)).toMatchObject({ status: "failed", errorCode: "ai_provider_unavailable", attempt: 3 });
    expect(provider.doGenerateCalls).toHaveLength(3);
  });

  it("releases budget for jobs that never reached the provider and caps manual analyses at ten a day", async () => {
    const { sessionId } = await session(["Wrong Answer", "Accepted"]);
    vi.mocked(dispatchAiJob).mockRejectedValueOnce(new Error("queue down"));
    expect(await requestError(analyze(sessionId))).toEqual({ status: 503, code: "queue_publish_failed" });
    expect((await jobsOf())[0]).toMatchObject({ status: "failed", errorCode: "queue_publish_failed", attempt: 0 });

    const queued = await analyze(sessionId);
    expect(await cancelOwnedAiJob(USER, queued.id)).toMatchObject({ status: "cancelled" });
    await processAiJob(queued.id, "late-delivery");
    expect(provider.doGenerateCalls).toHaveLength(0);
    expect(await analysesUsedToday(getDb(), USER, "manual", todayStart())).toBe(0);

    const spent = Array.from({ length: 10 }, (_, index) => ({
      id: `spent-${index}`, userId: USER, problemId: queued.problemId, kind: "analysis" as const, action: "session_analyze" as const,
      status: "succeeded" as const, idempotencyKey: `spent-${index}`, inputEnvelope: queued.inputEnvelope, provider: "openai" as const,
      model: "gpt-test", reasoningMode: "fast" as const, generationLanguage: "en" as const, trigger: "manual" as const, attempt: 1,
    }));
    await getDb().insert(schema.aiJobs).values(spent);
    expect(await requestError(analyze(sessionId))).toEqual({ status: 429, code: "analysis_budget_exhausted" });
  });
});

describe("automatic analysis", () => {
  const qualifying = ["Wrong Answer", "Wrong Answer", "Accepted"];
  // The deployment default: on unless switched off.
  const enable = () => vi.unstubAllEnvs();

  it("runs by default once the user has their own key, unless the deployment or the user switches it off", async () => {
    await session(qualifying);
    expect(await jobsOf()).toEqual([]);

    enable();
    await setAnalysisSettings(USER, { automatic: false });
    await session(qualifying);
    expect(await jobsOf()).toEqual([]);

    await setAnalysisSettings(USER, { automatic: true });
    const { sessionId } = await session(qualifying);
    const [automatic] = await jobsOf();
    expect(automatic).toMatchObject({ trigger: "automatic", status: "queued", practiceSessionId: sessionId });
    // It waits briefly, so verdicts still being judged at Finish are included.
    expect(automatic!.runAfter!.getTime() - automatic!.createdAt.getTime()).toBe(AUTOMATIC_ANALYSIS_DELAY_MS);
    expect(automatic!.dispatchedAt).not.toBeNull();
    expect(dispatchAiJob).toHaveBeenCalledWith(automatic!.id);

    // Without the user's own key nothing is planned (never the hosted key).
    await setAiSettings(USER, { provider: "openai", model: "gpt-test", apiKey: "" });
    await session(qualifying);
    expect(await jobsOf()).toHaveLength(1);
  });

  it("keeps the intent when the queue is down, and recovery sends it later", async () => {
    enable();
    vi.mocked(dispatchAiJob).mockRejectedValueOnce(new Error("queue down"));
    await session(qualifying);
    const [stranded] = await jobsOf();
    expect(stranded).toMatchObject({ status: "queued", dispatchedAt: null });

    // A dispatch may still be in flight for a few seconds; only older intents are re-sent.
    const createdAt = stranded!.createdAt.getTime();
    expect(await redispatchStrandedJobs({ userId: USER, now: new Date(createdAt + 10_000) })).toEqual({ stranded: 0, dispatched: 0 });
    expect(await redispatchStrandedJobs({ userId: USER, now: new Date(createdAt + MIN) })).toEqual({ stranded: 1, dispatched: 1 });
    expect((await job(stranded!.id)).dispatchedAt).not.toBeNull();
    expect(await redispatchStrandedJobs({ now: new Date(createdAt + 2 * MIN) })).toEqual({ stranded: 0, dispatched: 0 });
  });

  it("has no daily cap: every qualifying session is analyzed once", async () => {
    enable();
    for (let index = 0; index < 4; index += 1) await session(qualifying);
    expect(await jobsOf()).toHaveLength(4);
  });

  it("plans one job per session and evidence, however often it is asked", async () => {
    enable();
    const { sessionId } = await session(qualifying);
    const context = (await loadAutomaticAnalysisContext(USER))!;
    const planned = await getDb().transaction((tx) => planAutomaticAnalysis(tx, USER, sessionId, context, new Date()));
    expect(planned).toBeNull();
    // Even after the first job ended, the same evidence is not analyzed again.
    await getDb().update(schema.aiJobs).set({ status: "succeeded", activeDedupKey: null });
    expect(await getDb().transaction((tx) => planAutomaticAnalysis(tx, USER, sessionId, context, new Date()))).toBeNull();
    expect(await jobsOf()).toHaveLength(1);
  });

  it("runs for every finished session with code, accepted or not, and never for an unfinished session or one without code", async () => {
    enable();
    await session(["Wrong Answer", "Accepted"], { finish: false });
    await session(["Wrong Answer"], { codes: [null] });
    expect(await jobsOf()).toEqual([]);
    const clean = await session(["Accepted"]);
    const failedOnly = await session(["Wrong Answer"]);
    const sameCode = await session(["Wrong Answer", "Wrong Answer", "Accepted"], { codes: ["same", "same", "done"] });
    expect((await jobsOf()).map((row) => row.practiceSessionId).sort()).toEqual([clean.sessionId, failedOnly.sessionId, sameCode.sessionId].sort());
    expect(provider.doGenerateCalls).toHaveLength(0);
  });

  it("runs for a review exactly as for a first practice, before and regardless of its rating", async () => {
    enable();
    const first = await session(["Accepted"]);
    const review = await session(["Accepted"], { reviewOf: first.problemId });
    const [row] = await getDb().select().from(schema.practiceSessions).where(eq(schema.practiceSessions.id, review.sessionId));
    expect(row).toMatchObject({ type: "scheduled_review", status: "completed", ratingDisposition: "pending" });
    const planned = (await jobsOf()).filter((row) => row.practiceSessionId === review.sessionId);
    expect(planned).toMatchObject([{ trigger: "automatic", status: "queued" }]);
    const state = await getSessionAnalysisState(USER, review.sessionId);
    expect(state!.job).toMatchObject({ trigger: "automatic", status: "queued" });
  });

  it("does not retry a rejected key: the job fails at once", async () => {
    enable();
    const { sessionId } = await session(qualifying);
    useModel(new APICallError({ message: "Incorrect API key provided", url: "https://api.openai.com/v1/chat/completions", requestBodyValues: {}, statusCode: 401 }));
    const [planned] = await jobsOf();
    await getDb().update(schema.aiJobs).set({ runAfter: new Date() }).where(eq(schema.aiJobs.id, planned!.id));
    await processAiJob(planned!.id, "worker-auth");
    expect(await job(planned!.id)).toMatchObject({ status: "failed", errorCode: "ai_request_rejected", attempt: 1 });
    expect(provider.doGenerateCalls).toHaveLength(1);
    expect((await getSessionAnalysisState(USER, sessionId))!.job).toMatchObject({ status: "failed", errorCode: "ai_request_rejected" });
  });
});

/**
 * Real-provider smoke test for session analysis. For every provider whose key
 * is set (SMOKE_<PROVIDER>_API_KEY, e.g. in the git-ignored
 * `.env.smoke.local`), it runs one fixture practice session through the real
 * pipeline (job creation, the queue runner, the provider call, schema
 * validation, and the commit) against a throwaway SQLite database. Then it
 * checks that a deliberately invalid key fails at once without a retry.
 *
 * It prints provider, model, outcome, and timing only. It never prints keys,
 * request headers, or raw provider responses, and silences all logging while
 * calls run (provider error messages can echo parts of a key).
 *
 *   pnpm qa:provider-smoke
 *   SMOKE_OPENAI_MODEL=gpt-5 pnpm qa:provider-smoke   # another model
 */
import { randomBytes } from "node:crypto";

type Provider = "deepseek" | "openai" | "anthropic" | "google";
const PROVIDERS: { provider: Provider; defaultModel: string }[] = [
  { provider: "deepseek", defaultModel: "deepseek-v4-flash" },
  { provider: "openai", defaultModel: "gpt-4o-mini" },
  { provider: "anthropic", defaultModel: "claude-haiku-4-5-20251001" },
  { provider: "google", defaultModel: "gemini-3.5-flash" },
];

// Isolation before any server module loads: a throwaway database, a random
// encryption secret, no queue (the QA profile's dispatch is a no-op), and no
// fake-provider redirect.
process.env.ANKIFY_PROFILE = "qa";
process.env.AI_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("hex");
process.env.ANKIFY_AUTOMATIC_ANALYSIS = "disabled";
delete process.env.ANKIFY_QA_AI_BASE_URL;
delete process.env.ANKIFY_STARTER_AI_API_KEY;
(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

const keyName = (provider: Provider) => `SMOKE_${provider.toUpperCase()}_API_KEY`;
const modelName = (provider: Provider) => `SMOKE_${provider.toUpperCase()}_MODEL`;

/** Runs `task` with console output swallowed. */
async function quietly<T>(task: () => Promise<T>): Promise<T> {
  const saved = { error: console.error, warn: console.warn, log: console.log, info: console.info };
  console.error = console.warn = console.log = console.info = () => undefined;
  try {
    return await task();
  } finally {
    Object.assign(console, saved);
  }
}

async function main() {
  const configured = PROVIDERS.filter(({ provider }) => process.env[keyName(provider)]);
  if (configured.length === 0) {
    console.log("No SMOKE_<PROVIDER>_API_KEY is set. Put keys in .env.smoke.local (git-ignored); see docs/TEST_GUIDE.md.");
    process.exit(1);
  }

  const { createTestDb } = await import("../src/server/test-db");
  const testDb = createTestDb();
  await testDb.migrate();
  const { getDb, schema } = await import("@ankify/db");
  const { eq } = await import("drizzle-orm");
  const { setAiSettings } = await import("../src/server/settings");
  const { startPracticeSession, ingestSessionObservations, runSessionCommand } = await import("../src/server/practice-sessions/commands");
  const { startAiJobForUser } = await import("../src/server/ai-generation/start");
  const { processAiJob } = await import("../src/server/ai-generation/runner");
  const { getSessionAnalysisState } = await import("../src/server/session-analysis/queries");

  let counter = 0;
  /** A finished practice: two failing attempts, then the fix. */
  async function fixtureSession(userId: string) {
    counter += 1;
    const start = new Date(Date.now() - 60 * 60_000);
    const ownerToken = crypto.randomUUID();
    const started = await startPracticeSession(userId, {
      requestId: crypto.randomUUID(),
      target: {
        kind: "leetcode",
        problem: {
          leetcodeSlug: `smoke-max-subarray-${counter}`,
          leetcodeId: 90_000 + counter,
          title: "Maximum Subarray",
          difficulty: "Medium",
          url: "https://leetcode.com/problems/maximum-subarray/",
          descriptionMd: "<p>Given an integer array nums, find the subarray with the largest sum, and return its sum.</p><p>1 &lt;= nums.length &lt;= 10^5</p>",
          topicTags: ["Array", "Dynamic Programming"],
          similarSlugs: [],
        },
      },
      mode: "practice",
      ownerToken,
      baseline: { state: "none" },
      supersedePendingRating: false,
    }, start);
    if (!started.ok) throw new Error(started.error);
    const sessionId = started.response.session.id;
    const attempts = [
      {
        verdict: "Wrong Answer" as const,
        code: "class Solution:\n    def maxSubArray(self, nums):\n        best = 0\n        current = 0\n        for x in nums:\n            current = max(0, current + x)\n            best = max(best, current)\n        return best\n",
        failed: { failedTestcase: "[-1]", expectedOutput: "-1", actualOutput: "0" },
      },
      {
        verdict: "Wrong Answer" as const,
        code: "class Solution:\n    def maxSubArray(self, nums):\n        best = 0\n        current = 0\n        for x in nums:\n            current = max(x, current + x)\n            best = max(best, current)\n        return best\n",
        failed: { failedTestcase: "[-2,-1]", expectedOutput: "-1", actualOutput: "0" },
      },
      {
        verdict: "Accepted" as const,
        code: "class Solution:\n    def maxSubArray(self, nums):\n        best = nums[0]\n        current = nums[0]\n        for x in nums[1:]:\n            current = max(x, current + x)\n            best = max(best, current)\n        return best\n",
        failed: {},
      },
    ];
    const observed = await ingestSessionObservations(userId, sessionId, {
      observations: attempts.map((attempt, index) => ({
        leetcodeSubmissionId: String(800_000 + counter * 10 + index),
        verdict: attempt.verdict,
        submittedAt: new Date(start.getTime() + (index + 1) * 60_000).toISOString(),
        detail: { language: "python3", code: attempt.code, ...attempt.failed },
      })),
    }, new Date(start.getTime() + 10 * 60_000));
    if (!observed.ok) throw new Error(observed.error);
    const finished = await runSessionCommand(userId, sessionId, {
      type: "finish",
      requestId: crypto.randomUUID(),
      ownerToken,
      result: "solved",
      occurredAt: new Date(start.getTime() + 12 * 60_000).toISOString(),
    }, new Date(start.getTime() + 12 * 60_000));
    if (!finished.ok) throw new Error(finished.error);
    return sessionId;
  }

  /** Delivers a job until it ends; a retryable failure is retried at once. */
  async function runJob(jobId: string) {
    for (let delivery = 1; delivery <= 3; delivery += 1) {
      await processAiJob(jobId, `smoke-${delivery}`);
      const [job] = await getDb().select().from(schema.aiJobs).where(eq(schema.aiJobs.id, jobId));
      if (job!.status !== "queued") return job!;
      await getDb().update(schema.aiJobs).set({ runAfter: new Date() }).where(eq(schema.aiJobs.id, jobId));
    }
    return (await getDb().select().from(schema.aiJobs).where(eq(schema.aiJobs.id, jobId)))[0]!;
  }

  async function analyze(userId: string, provider: Provider, model: string, apiKey: string) {
    await getDb().insert(schema.user).values({ id: userId, name: "Smoke", email: `${userId}@smoke.test` });
    await setAiSettings(userId, { provider, model, apiKey });
    const sessionId = await fixtureSession(userId);
    const job = await startAiJobForUser(userId, { action: "session_analyze", practiceSessionId: sessionId, requestId: crypto.randomUUID() });
    const started = Date.now();
    const done = await runJob(job.id);
    const state = await getSessionAnalysisState(userId, sessionId);
    return { job: done, state, ms: Date.now() - started };
  }

  const rows: string[][] = [];
  let failures = 0;
  for (const { provider, defaultModel } of configured) {
    const model = process.env[modelName(provider)] || defaultModel;
    const apiKey = process.env[keyName(provider)]!;
    try {
      const real = await quietly(() => analyze(`smoke-${provider}`, provider, model, apiKey));
      const result = real.state?.analysis?.result;
      const ok = real.job.status === "succeeded" && result != null;
      // An empty provider account is outside ankify; reported, not failed.
      const blocked = real.job.errorCode === "ai_quota_exceeded";
      if (!ok && !blocked) failures += 1;
      rows.push([
        provider,
        model,
        ok ? "PASS" : blocked ? "BLOCKED" : "FAIL",
        ok
          ? `${result!.findings.length} finding(s)${result!.findings.length ? ` [${result!.findings.map((finding) => finding.category).join(", ")}]` : ""}${result!.insufficientEvidence ? ", insufficient evidence" : ""}; ${real.state!.analysis!.usage.inputTokens ?? "?"} in / ${real.state!.analysis!.usage.outputTokens ?? "?"} out tokens`
          : blocked
            ? `provider account has no credit or quota (classified ai_quota_exceeded, ${real.job.attempt} attempt)`
            : `job ${real.job.status}, ${real.job.errorCode ?? "no error code"} after ${real.job.attempt} attempt(s)`,
        `${(real.ms / 1000).toFixed(1)} s`,
      ]);
    } catch (error) {
      failures += 1;
      rows.push([provider, model, "FAIL", `setup error: ${error instanceof Error ? error.name : "unknown"}`, "-"]);
    }

    // An invalid key must fail at once, classified, without a retry.
    try {
      const bad = await quietly(() => analyze(`smoke-${provider}-badkey`, provider, model, `invalid-smoke-key-${randomBytes(6).toString("hex")}`));
      const ok = bad.job.status === "failed" && bad.job.errorCode === "ai_request_rejected" && bad.job.attempt === 1;
      if (!ok) failures += 1;
      rows.push([provider, model, ok ? "PASS" : "FAIL", `invalid key: job ${bad.job.status}, ${bad.job.errorCode ?? "no error code"}, ${bad.job.attempt} attempt(s)`, `${(bad.ms / 1000).toFixed(1)} s`]);
    } catch (error) {
      failures += 1;
      rows.push([provider, model, "FAIL", `invalid key: setup error ${error instanceof Error ? error.name : "unknown"}`, "-"]);
    }
  }

  testDb.cleanup();
  const header = ["provider", "model", "result", "detail", "time"];
  const widths = header.map((_, column) => Math.max(header[column]!.length, ...rows.map((row) => row[column]!.length)));
  const line = (row: string[]) => row.map((cell, column) => cell.padEnd(widths[column]!)).join("  ");
  console.log(line(header));
  for (const row of rows) console.log(line(row));
  const skipped = PROVIDERS.filter((entry) => !configured.includes(entry)).map((entry) => entry.provider);
  if (skipped.length) console.log(`skipped (no key): ${skipped.join(", ")}`);
  process.exit(failures > 0 ? 1 : 0);
}

void main();

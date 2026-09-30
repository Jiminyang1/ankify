import type { AiJobCreateRequestInput, AnalysisTrigger, SkillDimensionId } from "@ankify/contracts";
import { automaticAnalysisTrigger, hasAnalyzableCode, PROFILE_READINESS } from "@ankify/core";
import { getDb, schema, type AiJob } from "@ankify/db";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { dispatchAiJob } from "../ai-generation/dispatch";
import { AiJobRequestError, encryptJobInput, MAX_ACTIVE_JOBS_PER_USER, markJobDispatched } from "../ai-generation/jobs";
import { isAutomaticAnalysisEnabled, isWorkflowEnabled } from "../features";
import type { DbTransaction } from "../practice-sessions/store";
import { getAnalysisSettings, getGenerationSettings, getOwnAiRuntimeSettings, getReviewSettings, type AiRuntimeSettings } from "../settings";
import { getZonedDayBounds } from "../time-zone";
import { ANALYZER_VERSION, loadAnalysisEvidence, type SessionAnalysisEvidence } from "./evidence";

/** Manual analyses per local day, independent of the automatic budget. */
export const MANUAL_DAILY_ANALYSES = 10;
/** A queued job without a dispatch this old counts as stranded. */
const STRANDED_AFTER_MS = 30_000;
const PATTERN_WINDOW_MS = 90 * 86_400_000;
const ACTIVE = ["queued", "running"] as const;

type Db = ReturnType<typeof getDb> | DbTransaction;
type AnalyzeInput = Extract<AiJobCreateRequestInput, { action: "session_analyze" }>;

const dedupKey = (sessionId: string) => `session-analyze:${sessionId}`;

/**
 * Jobs of one trigger that count against a local day's budget: active ones
 * (their reservation) and any that reached a provider attempt. Cache hits and
 * jobs that ended before any attempt (cancelled, never published) do not.
 */
export async function analysesUsedToday(db: Db, userId: string, trigger: AnalysisTrigger, dayStart: Date) {
  const j = schema.aiJobs;
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(j)
    .where(
      and(
        eq(j.userId, userId),
        eq(j.action, "session_analyze"),
        eq(j.trigger, trigger),
        gte(j.createdAt, dayStart),
        or(inArray(j.status, [...ACTIVE]), gt(j.attempt, 0)),
      ),
    );
  return row?.count ?? 0;
}

export async function findCachedAnalysis(db: Db, userId: string, evidence: SessionAnalysisEvidence, ai: Pick<AiRuntimeSettings, "provider" | "model">) {
  const a = schema.sessionAnalyses;
  const [row] = await db
    .select({ id: a.id })
    .from(a)
    .where(
      and(
        eq(a.userId, userId),
        eq(a.practiceSessionId, evidence.session.id),
        eq(a.evidenceDigest, evidence.digest),
        eq(a.analyzerVersion, ANALYZER_VERSION),
        eq(a.provider, ai.provider),
        eq(a.model, ai.model),
      ),
    )
    .limit(1);
  return row ?? null;
}

function jobValues(
  userId: string,
  evidence: SessionAnalysisEvidence,
  ai: AiRuntimeSettings,
  language: "en" | "zh",
  trigger: AnalysisTrigger,
  idempotencyKey: string,
  requestId: string,
  now: Date,
) {
  return {
    id: nanoid(16),
    userId,
    problemId: evidence.session.problemId,
    kind: "analysis" as const,
    action: "session_analyze" as const,
    idempotencyKey,
    inputEnvelope: encryptJobInput({ action: "session_analyze", practiceSessionId: evidence.session.id, requestId }),
    provider: ai.provider,
    model: ai.model,
    reasoningMode: ai.reasoningMode,
    generationLanguage: language,
    practiceSessionId: evidence.session.id,
    evidenceDigest: evidence.digest,
    trigger,
    runAfter: now,
    queuedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * A user's explicit "Analyze session". Only the user's own key is accepted;
 * unchanged evidence returns the cached analysis as an already-succeeded job
 * that costs no budget. One analysis job per session may be active.
 */
export async function createSessionAnalysisJob(userId: string, input: AnalyzeInput, now = new Date()): Promise<AiJob> {
  if (!isWorkflowEnabled("session_analysis")) {
    throw new AiJobRequestError("workflow_disabled", "Session analysis is temporarily unavailable.", 503);
  }
  const ai = await getOwnAiRuntimeSettings(userId);
  if (!ai) {
    throw new AiJobRequestError("own_key_required", "Session analysis uses your own AI key. Add one in Settings.", 403);
  }
  const [generation, review] = await Promise.all([getGenerationSettings(userId), getReviewSettings(userId)]);
  const { start: dayStart } = getZonedDayBounds(review.timeZone, now);
  const j = schema.aiJobs;

  return getDb().transaction(async (tx) => {
    // Serialized writers (BEGIN IMMEDIATE): a concurrent replay sees this row.
    const [replay] = await tx
      .select()
      .from(j)
      .where(and(eq(j.userId, userId), eq(j.idempotencyKey, input.requestId)))
      .limit(1);
    if (replay) {
      if (replay.action !== "session_analyze" || replay.practiceSessionId !== input.practiceSessionId) {
        throw new AiJobRequestError("ai_job_request_conflict", "This request id was already used for a different AI job.", 409);
      }
      return replay;
    }

    const evidence = await loadAnalysisEvidence(tx, userId, input.practiceSessionId);
    if (!evidence) throw new AiJobRequestError("session_not_found", "Practice session not found.", 404);
    if (evidence.session.status !== "completed") {
      throw new AiJobRequestError("session_not_completed", "Finish the session before analyzing it.", 409);
    }
    if (!hasAnalyzableCode(evidence.attempts)) {
      throw new AiJobRequestError("insufficient_evidence", "No submitted code was captured for this session.", 409);
    }
    const values = jobValues(userId, evidence, ai, generation.language, "manual", input.requestId, input.requestId, now);

    const cached = await findCachedAnalysis(tx, userId, evidence, ai);
    if (cached) {
      const [row] = await tx
        .insert(j)
        .values({ ...values, status: "succeeded", activeDedupKey: null, resultAnalysisId: cached.id, finishedAt: now })
        .returning();
      return row!;
    }

    const [active] = await tx
      .select({ id: j.id })
      .from(j)
      .where(and(eq(j.userId, userId), eq(j.activeDedupKey, dedupKey(evidence.session.id)), inArray(j.status, [...ACTIVE])))
      .limit(1);
    if (active) throw new AiJobRequestError("ai_job_conflict", "This session is already being analyzed.", 409);

    const [{ count } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(j)
      .where(and(eq(j.userId, userId), inArray(j.status, [...ACTIVE])));
    if (count >= MAX_ACTIVE_JOBS_PER_USER) {
      throw new AiJobRequestError("ai_job_limit_reached", `You already have ${MAX_ACTIVE_JOBS_PER_USER} active AI jobs. Wait for one to finish.`, 429);
    }
    if ((await analysesUsedToday(tx, userId, "manual", dayStart)) >= MANUAL_DAILY_ANALYSES) {
      throw new AiJobRequestError("analysis_budget_exhausted", `You can analyze ${MANUAL_DAILY_ANALYSES} sessions a day.`, 429);
    }
    const [row] = await tx
      .insert(j)
      .values({ ...values, status: "queued", activeDedupKey: dedupKey(evidence.session.id) })
      .returning();
    return row!;
  });
}

export type AutomaticAnalysisContext = {
  ai: AiRuntimeSettings;
  language: "en" | "zh";
  dailyLimit: number;
  dayStart: Date;
};

/**
 * Read before a session transaction: null unless automatic analysis is
 * available on this deployment, switched on by the user, has budget, and the
 * user has their own key.
 */
export async function loadAutomaticAnalysisContext(userId: string, now = new Date()): Promise<AutomaticAnalysisContext | null> {
  if (!isAutomaticAnalysisEnabled()) return null;
  const settings = await getAnalysisSettings(userId);
  if (!settings.automatic || settings.dailyAutomaticLimit === 0) return null;
  const ai = await getOwnAiRuntimeSettings(userId);
  if (!ai) return null;
  const [generation, review] = await Promise.all([getGenerationSettings(userId), getReviewSettings(userId)]);
  return { ai, language: generation.language, dailyLimit: settings.dailyAutomaticLimit, dayStart: getZonedDayBounds(review.timeZone, now).start };
}

/**
 * Inside the transaction that completed a session (or confirmed an
 * improvement): persists an automatic analysis job when the session qualifies,
 * so the intent commits with the session. Returns the job id to publish after
 * commit; a failed publish leaves it for `redispatchStrandedJobs()`. At most
 * one automatic job per session, ever.
 */
export async function planAutomaticAnalysis(
  tx: DbTransaction,
  userId: string,
  sessionId: string,
  context: AutomaticAnalysisContext,
  options: { testsImprovement?: boolean },
  now: Date,
): Promise<string | null> {
  const evidence = await loadAnalysisEvidence(tx, userId, sessionId);
  if (!evidence || evidence.session.status !== "completed") return null;
  const trigger = automaticAnalysisTrigger({
    outcome: evidence.session.outcome,
    attempts: evidence.attempts,
    matchesConfirmedPattern: options.testsImprovement ? false : await matchesConfirmedPattern(tx, userId, evidence, now),
    testsImprovement: options.testsImprovement ?? false,
  });
  if (!trigger) return null;

  const j = schema.aiJobs;
  const [existing] = await tx
    .select({ id: j.id })
    .from(j)
    .where(
      and(
        eq(j.userId, userId),
        eq(j.practiceSessionId, sessionId),
        or(eq(j.trigger, "automatic"), inArray(j.status, [...ACTIVE])),
      ),
    )
    .limit(1);
  if (existing) return null;
  if (await findCachedAnalysis(tx, userId, evidence, context.ai)) return null;
  if ((await analysesUsedToday(tx, userId, "automatic", context.dayStart)) >= context.dailyLimit) return null;

  const requestId = crypto.randomUUID();
  const values = jobValues(userId, evidence, context.ai, context.language, "automatic", `auto:${sessionId}`, requestId, now);
  const inserted = await tx
    .insert(j)
    .values({ ...values, status: "queued", activeDedupKey: dedupKey(sessionId) })
    .onConflictDoNothing()
    .returning({ id: j.id });
  return inserted[0]?.id ?? null;
}

/**
 * Whether a confirmed mistake on another problem from the last 90 days shares
 * a topic with this problem and a failing verdict with this session.
 */
async function matchesConfirmedPattern(tx: DbTransaction, userId: string, evidence: SessionAnalysisEvidence, now: Date) {
  const failing = new Set(evidence.attempts.filter((attempt) => attempt.verdict !== "Accepted").map((attempt) => attempt.verdict));
  if (failing.size === 0) return false;
  const [problem] = await tx
    .select({ topicTags: schema.problems.topicTags })
    .from(schema.problems)
    .where(and(eq(schema.problems.id, evidence.session.problemId), eq(schema.problems.userId, userId)))
    .limit(1);
  const topics = new Set(problem?.topicTags ?? []);
  if (topics.size === 0) return false;

  const m = schema.mistakeRecords;
  const p = schema.problems;
  const since = new Date(now.getTime() - PATTERN_WINDOW_MS);
  const recent = and(eq(m.userId, userId), eq(m.status, "confirmed"), ne(m.problemId, evidence.session.problemId), gte(m.createdAt, since));
  const [linked, observed] = await Promise.all([
    tx
      .select({ id: m.id, topicTags: p.topicTags, verdict: schema.submissions.status })
      .from(m)
      .innerJoin(p, and(eq(p.id, m.problemId), eq(p.userId, m.userId)))
      .leftJoin(schema.submissions, and(eq(schema.submissions.id, m.submissionId), eq(schema.submissions.userId, m.userId)))
      .where(recent),
    tx
      .select({ id: m.id, verdict: schema.practiceSessionSubmissions.verdict })
      .from(m)
      .innerJoin(
        schema.practiceSessionSubmissions,
        and(eq(schema.practiceSessionSubmissions.sessionId, m.practiceSessionId), eq(schema.practiceSessionSubmissions.userId, m.userId)),
      )
      .where(and(recent, inArray(schema.practiceSessionSubmissions.association, ["automatic", "confirmed"]))),
  ]);
  const verdicts = new Map<string, Set<string>>();
  for (const row of [...linked, ...observed]) {
    if (!row.verdict || row.verdict === "Accepted") continue;
    const set = verdicts.get(row.id) ?? new Set<string>();
    set.add(row.verdict);
    verdicts.set(row.id, set);
  }
  return linked.some(
    (row) => row.topicTags.some((topic) => topics.has(topic)) && [...(verdicts.get(row.id) ?? [])].some((verdict) => failing.has(verdict)),
  );
}

/**
 * A category with confirmed evidence from two contexts across two problems in
 * the last 90 days (the profile's readiness rule; contexts as in the profile).
 */
export async function isEstablishedPattern(tx: DbTransaction, userId: string, category: SkillDimensionId, now: Date) {
  const m = schema.mistakeRecords;
  const rows = await tx
    .select({ id: m.id, problemId: m.problemId, practiceSessionId: m.practiceSessionId, submissionId: m.submissionId, quizSessionId: m.quizSessionId, quizItemId: m.quizItemId, reviewEventId: m.reviewEventId })
    .from(m)
    .where(and(eq(m.userId, userId), eq(m.status, "confirmed"), eq(m.primaryCategory, category), gte(m.createdAt, new Date(now.getTime() - PATTERN_WINDOW_MS))));
  const contexts = new Set(
    rows.map((row) =>
      row.practiceSessionId
        ? `session:${row.practiceSessionId}`
        : row.submissionId
          ? `submission:${row.submissionId}`
          : row.quizSessionId && row.quizItemId
            ? `quiz:${row.quizSessionId}:${row.quizItemId}`
            : row.reviewEventId
              ? `review:${row.reviewEventId}`
              : `record:${row.id}`,
    ),
  );
  const problems = new Set(rows.map((row) => row.problemId));
  return contexts.size >= PROFILE_READINESS.categoryContexts && problems.size >= PROFILE_READINESS.categoryProblems;
}

/** Publishes jobs planned inside a committed transaction; failures wait for recovery. */
export async function publishPlannedJob(jobId: string | null) {
  if (!jobId) return;
  try {
    await dispatchAiJob(jobId);
    await markJobDispatched(jobId);
  } catch (error) {
    console.error("[session-analysis] dispatch deferred to recovery", { jobId, error: error instanceof Error ? error.name : "unknown" });
  }
}

/**
 * Re-sends queued jobs whose dispatch never reached the queue (a failed
 * publish, or a crash between commit and publish). Sending is idempotent per
 * job id, and a delivery of a finished job is a no-op. Runs from the cron
 * route and, per user, on their next request.
 */
export async function redispatchStrandedJobs(options: { userId?: string; now?: Date; limit?: number } = {}) {
  const now = options.now ?? new Date();
  const j = schema.aiJobs;
  const rows = await getDb()
    .select({ id: j.id })
    .from(j)
    .where(
      and(
        options.userId ? eq(j.userId, options.userId) : undefined,
        eq(j.status, "queued"),
        isNull(j.dispatchedAt),
        lt(j.createdAt, new Date(now.getTime() - STRANDED_AFTER_MS)),
      ),
    )
    .orderBy(asc(j.createdAt))
    .limit(options.limit ?? 20);
  let dispatched = 0;
  for (const row of rows) {
    try {
      await dispatchAiJob(row.id);
      await markJobDispatched(row.id, now);
      dispatched += 1;
    } catch (error) {
      // The queue is unavailable; the next run tries again.
      console.error("[session-analysis] redispatch failed", { jobId: row.id, error: error instanceof Error ? error.name : "unknown" });
      break;
    }
  }
  return { stranded: rows.length, dispatched };
}

/** The session's latest analysis job, if any. */
export async function latestSessionAnalysisJob(userId: string, sessionId: string) {
  const j = schema.aiJobs;
  const [row] = await getDb()
    .select()
    .from(j)
    .where(and(eq(j.userId, userId), eq(j.practiceSessionId, sessionId), eq(j.action, "session_analyze")))
    .orderBy(desc(j.createdAt), desc(j.id))
    .limit(1);
  return row ?? null;
}

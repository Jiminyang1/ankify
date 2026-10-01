import {
  sessionAnalysisOutputSchema,
  type AiJobCreateRequestInput,
  type SessionAnalysisCoverage,
  type SessionAnalysisFinding,
  type SessionAnalysisOutput,
  type SessionAnalysisResult,
} from "@ankify/contracts";
import { hasAnalyzableCode } from "@ankify/core";
import { getDb, schema, type AiJob } from "@ankify/db";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { and, eq, ne } from "drizzle-orm";
import { buildModel, providerCallOptions } from "../ai";
import { nonRetryableJobError } from "../ai-generation/errors";
import { loadRunningJob, markSucceeded } from "../ai-generation/jobs";
import { isWorkflowEnabled } from "../features";
import { getOwnAiRuntimeSettings, type AiRuntimeSettings } from "../settings";
import {
  ANALYSIS_OUTPUT_TOKENS,
  ANALYZER_VERSION,
  buildAnalysisPrompt,
  loadAnalysisEvidence,
  type AnalysisAttemptEvidence,
  type SessionAnalysisEvidence,
} from "./evidence";
import { findCachedAnalysis } from "./jobs";

const ANALYSIS_TIMEOUT_MS = 175_000;

type AnalyzeInput = Extract<AiJobCreateRequestInput, { action: "session_analyze" }>;

/**
 * One delivery of a session-analysis job. The user's own key is checked again
 * here: a removed key fails the job and never falls back to the hosted key.
 * The analysis, its candidate mistakes, and the terminal job state commit in
 * one transaction, so a redelivery after commit changes nothing.
 */
export async function runSessionAnalysisJob(job: AiJob, input: AnalyzeInput) {
  // The kill switch also stops work queued before it was set.
  if (!isWorkflowEnabled("session_analysis")) {
    throw nonRetryableJobError("workflow_disabled", "Session analysis is temporarily unavailable.");
  }
  const ai = await getOwnAiRuntimeSettings(job.userId);
  if (!ai) throw nonRetryableJobError("own_key_required", "Add your own AI key in Settings to analyze sessions.");
  if (ai.provider !== job.provider || ai.model !== job.model) {
    throw nonRetryableJobError("ai_configuration_changed", "Your AI settings changed. Analyze the session again.");
  }
  const evidence = await loadAnalysisEvidence(getDb(), job.userId, input.practiceSessionId);
  if (!evidence) throw nonRetryableJobError("session_not_found", "The practice session no longer exists.");
  if (!hasAnalyzableCode(evidence.attempts)) throw nonRetryableJobError("insufficient_evidence", "No submitted code was captured for this session.");

  // Another job may have analyzed exactly this evidence meanwhile.
  const cached = await findCachedAnalysis(getDb(), job.userId, evidence, ai);
  if (cached) {
    await commitExisting(job, cached.id);
    return;
  }

  const language = job.generationLanguage === "zh" ? "zh" : "en";
  const { system, prompt, coverage, attempts } = buildAnalysisPrompt(evidence, language);
  const { output, usage } = await callAnalyzer(ai, system, prompt);
  await commitAnalysis(job, evidence, coverage, toAnalysisResult(output, attempts), usage, ai);
}

async function callAnalyzer(ai: AiRuntimeSettings, system: string, prompt: string) {
  const usesDeepSeekThinking = ai.provider === "deepseek" && ai.reasoningMode === "thinking";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);
  try {
    const result = await generateText({
      model: buildModel(ai),
      output: Output.object({ schema: sessionAnalysisOutputSchema }),
      system,
      prompt,
      ...providerCallOptions(ai, ANALYSIS_OUTPUT_TOKENS),
      // One provider call per job attempt; the job allows three attempts.
      maxRetries: 0,
      ...(!usesDeepSeekThinking ? { temperature: 0.2 } : {}),
      abortSignal: controller.signal,
    });
    return {
      output: result.output,
      usage: { inputTokens: result.usage.inputTokens ?? null, outputTokens: result.usage.outputTokens ?? null },
    };
  } catch (error) {
    // Output that does not match the schema is not retried or repaired.
    if (NoObjectGeneratedError.isInstance(error)) {
      throw nonRetryableJobError("ai_output_invalid", "The AI returned an analysis in an unexpected format.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolves attempt labels to the session's observations and code ranges. A
 * label the prompt never showed is dropped, a line range outside that
 * attempt's code falls back to the attempt itself, and each category keeps
 * only its first finding.
 */
export function toAnalysisResult(output: SessionAnalysisOutput, attempts: readonly AnalysisAttemptEvidence[]): SessionAnalysisResult {
  const byLabel = new Map(attempts.map((attempt) => [attempt.label, attempt]));
  const seen = new Set<string>();
  const findings: SessionAnalysisFinding[] = [];
  for (const finding of output.findings) {
    if (seen.has(finding.category)) continue;
    const evidence: SessionAnalysisFinding["evidence"] = [];
    const keys = new Set<string>();
    for (const ref of finding.evidence) {
      const attempt = byLabel.get(ref.attempt);
      if (!attempt) continue;
      const lines = attempt.code ? attempt.code.split("\n").length : 0;
      const inRange = ref.startLine != null && ref.endLine != null && ref.startLine <= ref.endLine && ref.endLine <= lines;
      const item: SessionAnalysisFinding["evidence"][number] =
        attempt.submissionId && inRange
          ? { kind: "code_range", submissionId: attempt.submissionId, startLine: ref.startLine!, endLine: ref.endLine! }
          : { kind: "observation", observationId: attempt.observationId };
      const key = JSON.stringify(item);
      if (keys.has(key)) continue;
      keys.add(key);
      evidence.push(item);
    }
    // A cause must cite the attempts that show it; an uncited one is a guess.
    if (evidence.length === 0) continue;
    seen.add(finding.category);
    findings.push({
      mistakeId: null,
      category: finding.category,
      cause: finding.cause.trim(),
      nextStep: finding.nextStep?.trim() || null,
      confidence: finding.confidence,
      evidence,
    });
  }
  // "The evidence does not show a cause" overrides any finding offered anyway.
  return { summary: output.summary.trim(), insufficientEvidence: output.insufficientEvidence, findings: output.insufficientEvidence ? [] : findings };
}

async function commitExisting(job: AiJob, analysisId: string) {
  await getDb().transaction(async (tx) => {
    if (!(await loadRunningJob(tx, job))) return;
    await markSucceeded(tx, job, { resultAnalysisId: analysisId }, new Date());
  });
}

async function commitAnalysis(
  job: AiJob,
  evidence: SessionAnalysisEvidence,
  coverage: SessionAnalysisCoverage,
  result: SessionAnalysisResult,
  usage: { inputTokens: number | null; outputTokens: number | null },
  ai: AiRuntimeSettings,
) {
  const now = new Date();
  await getDb().transaction(async (tx) => {
    if (!(await loadRunningJob(tx, job))) return;
    const cached = await findCachedAnalysis(tx, job.userId, evidence, ai);
    if (cached) {
      await markSucceeded(tx, job, { resultAnalysisId: cached.id }, now);
      return;
    }
    const analysisId = `sa_${job.id}`;
    const m = schema.mistakeRecords;
    // A newer analysis replaces the earlier ones' open suggestions for this
    // session; what the user confirmed or dismissed stays.
    await tx
      .delete(m)
      .where(and(eq(m.userId, job.userId), eq(m.practiceSessionId, evidence.session.id), eq(m.origin, "ai_suggested"), eq(m.status, "candidate")));
    // Findings become candidates the user confirms, corrects, or dismisses. A
    // category already recorded for this session (by the user, or confirmed
    // or dismissed from an earlier analysis) gets no second record; the
    // finding stays in the analysis.
    const recorded = await tx
      .select({ category: m.primaryCategory })
      .from(m)
      .where(and(eq(m.userId, job.userId), eq(m.practiceSessionId, evidence.session.id), ne(m.status, "dismissed")));
    const taken = new Set(recorded.map((row) => row.category));
    const linked: SessionAnalysisResult = {
      ...result,
      findings: result.findings.map((finding) => ({ ...finding, mistakeId: taken.has(finding.category) ? null : `ai_${job.id}_${finding.category}` })),
    };
    await tx.insert(schema.sessionAnalyses).values({
      id: analysisId,
      userId: job.userId,
      problemId: evidence.session.problemId,
      practiceSessionId: evidence.session.id,
      jobId: job.id,
      evidenceDigest: evidence.digest,
      analyzerVersion: ANALYZER_VERSION,
      provider: ai.provider,
      model: ai.model,
      result: linked,
      coverage,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      createdAt: now,
    });

    for (const finding of linked.findings) {
      if (!finding.mistakeId) continue;
      await tx.insert(m).values({
        id: finding.mistakeId,
        userId: job.userId,
        problemId: evidence.session.problemId,
        primaryCategory: finding.category,
        summary: finding.cause,
        nextStep: finding.nextStep,
        sourceType: "practice_session",
        practiceSessionId: evidence.session.id,
        evidence: finding.evidence,
        analysisId,
        status: "candidate",
        origin: "ai_suggested",
        requestId: `analysis:${analysisId}:${finding.category}`,
        createdAt: now,
        updatedAt: now,
      });
    }
    await markSucceeded(tx, job, { resultAnalysisId: analysisId }, now);
  });
}

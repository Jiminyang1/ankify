import type { SessionAnalysisDto, SessionAnalysisStateDto } from "@ankify/contracts";
import { hasAnalyzableCode } from "@ankify/core";
import { getDb, schema, type SessionAnalysis } from "@ankify/db";
import { and, desc, eq } from "drizzle-orm";
import { toPublicAiJob } from "../ai-generation/jobs";
import { isWorkflowEnabled } from "../features";
import { toMistakeDto } from "../mistakes";
import { getAiSettings } from "../settings";
import { loadAnalysisEvidence } from "./evidence";
import { latestSessionAnalysisJob } from "./jobs";

function toAnalysisDto(row: SessionAnalysis, currentDigest: string): SessionAnalysisDto {
  return {
    id: row.id,
    practiceSessionId: row.practiceSessionId,
    problemId: row.problemId,
    analyzerVersion: row.analyzerVersion,
    provider: row.provider,
    model: row.model,
    result: row.result,
    coverage: row.coverage,
    usage: { inputTokens: row.inputTokens, outputTokens: row.outputTokens },
    stale: row.evidenceDigest !== currentDigest,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * A session's latest analysis (stale when the evidence changed since), its
 * latest analysis job, its AI candidate records, and whether a manual
 * analysis can start. `null` when the session is not the user's.
 */
export async function getSessionAnalysisState(userId: string, sessionId: string): Promise<SessionAnalysisStateDto | null> {
  const db = getDb();
  const evidence = await loadAnalysisEvidence(db, userId, sessionId);
  if (!evidence) return null;
  const a = schema.sessionAnalyses;
  const m = schema.mistakeRecords;
  const [[analysis], job, findings, ai] = await Promise.all([
    db
      .select()
      .from(a)
      .where(and(eq(a.userId, userId), eq(a.practiceSessionId, sessionId)))
      .orderBy(desc(a.createdAt), desc(a.id))
      .limit(1),
    latestSessionAnalysisJob(userId, sessionId),
    db
      .select()
      .from(m)
      .where(and(eq(m.userId, userId), eq(m.practiceSessionId, sessionId), eq(m.origin, "ai_suggested")))
      .orderBy(desc(m.createdAt), desc(m.id))
      .limit(20),
    getAiSettings(userId),
  ]);

  const manual: SessionAnalysisStateDto["manual"] = !isWorkflowEnabled("session_analysis")
    ? { available: false, reason: "disabled" }
    : !(ai.provider && ai.model && ai.encryptedApiKey)
      ? { available: false, reason: "own_key_required" }
      : evidence.session.status !== "completed"
        ? { available: false, reason: "session_not_completed" }
        : !hasAnalyzableCode(evidence.attempts)
          ? { available: false, reason: "insufficient_evidence" }
          : { available: true };

  return {
    analysis: analysis ? toAnalysisDto(analysis, evidence.digest) : null,
    job: job ? toPublicAiJob(job) : null,
    findings: findings.map(toMistakeDto),
    manual,
  };
}

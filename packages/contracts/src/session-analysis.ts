import { z } from "zod";
import type { MistakeRecordDto, PublicAiJobDto } from "./dto";
import { skillDimensionEnum, type SkillDimensionId } from "./schemas";

/**
 * Session analysis: one BYOK model call over one practice session's evidence.
 * Findings are inferences; they become `ai_suggested` mistake candidates and
 * count toward the profile only after the user confirms them.
 */

export const analysisTriggerEnum = z.enum(["manual", "automatic"]);
export type AnalysisTrigger = z.infer<typeof analysisTriggerEnum>;

/** Attempts are cited by their prompt labels (S1, S2, ...), never by ids. */
export const analysisAttemptLabelSchema = z.string().regex(/^S[1-9]\d?$/);

/** What the model must return. Validated once; there is no repair loop. */
export const sessionAnalysisOutputSchema = z.object({
  summary: z.string().min(1).max(600),
  /** The evidence did not show a cause; findings should then be empty. */
  insufficientEvidence: z.boolean(),
  findings: z
    .array(
      z.object({
        category: skillDimensionEnum,
        cause: z.string().min(1).max(400),
        nextStep: z.string().max(240).nullable(),
        confidence: z.enum(["low", "medium", "high"]),
        evidence: z
          .array(
            z.object({
              attempt: analysisAttemptLabelSchema,
              startLine: z.number().int().min(1).max(100_000).nullable(),
              endLine: z.number().int().min(1).max(100_000).nullable(),
            }),
          )
          .max(4),
      }),
    )
    .max(3),
});
export type SessionAnalysisOutput = z.infer<typeof sessionAnalysisOutputSchema>;

/** A stored finding: attempt labels resolved to the session's observations. */
export type SessionAnalysisFinding = {
  /** The candidate record created for it; null when the session already had
   *  a record of this category. */
  mistakeId: string | null;
  category: SkillDimensionId;
  cause: string;
  nextStep: string | null;
  confidence: "low" | "medium" | "high";
  evidence: (
    | { kind: "observation"; observationId: string }
    | { kind: "code_range"; submissionId: string; startLine: number; endLine: number }
  )[];
};

export type SessionAnalysisResult = {
  summary: string;
  insufficientEvidence: boolean;
  findings: SessionAnalysisFinding[];
};

/** What the model saw, so omissions are explicit rather than silent. */
export type SessionAnalysisCoverage = {
  attempts: number;
  attemptsWithCode: number;
  revisions: number;
  revisionsIncluded: string[];
  revisionsOmitted: string[];
  truncated: string[];
  descriptionIncluded: boolean;
  inputChars: number;
};

export type SessionAnalysisDto = {
  id: string;
  practiceSessionId: string;
  problemId: string;
  analyzerVersion: string;
  provider: string;
  model: string;
  result: SessionAnalysisResult;
  coverage: SessionAnalysisCoverage;
  usage: { inputTokens: number | null; outputTokens: number | null };
  /** The session's evidence changed after this analysis. */
  stale: boolean;
  createdAt: string;
};

export type SessionAnalysisUnavailableReason =
  | "disabled"
  | "own_key_required"
  | "session_not_completed"
  | "insufficient_evidence";

/** GET /api/practice-sessions/:id/analysis */
export type SessionAnalysisStateDto = {
  analysis: SessionAnalysisDto | null;
  /** The session's latest analysis job, when one exists. */
  job: PublicAiJobDto | null;
  /** The analysis's candidate records (current status included). */
  findings: MistakeRecordDto[];
  /** Whether a manual analysis can start now, and why not. */
  manual: { available: true } | { available: false; reason: SessionAnalysisUnavailableReason };
};

export const analysisSettingsSchema = z
  .object({
    /** Automatic analysis of qualifying sessions; off by default. */
    automatic: z.boolean(),
    /** Automatic jobs per local day (0-5). */
    dailyAutomaticLimit: z.number().int().min(0).max(5),
  })
  .strict();
export type AnalysisSettings = z.infer<typeof analysisSettingsSchema>;

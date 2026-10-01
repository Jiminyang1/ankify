/**
 * When a completed practice session qualifies for *automatic* analysis. These
 * are triggers for spending the user's own AI budget, not diagnoses: they only
 * say the session likely holds a cause worth explaining.
 */

export type AnalysisAttempt = {
  verdict: string;
  /** Hash of the submitted code; null when the code was not captured. */
  codeHash: string | null;
};

export type AutomaticAnalysisTrigger = "repeated_failures" | "pattern_recurrence";

export type AutomaticAnalysisInput = {
  outcome: "accepted" | "failed" | "unknown" | null;
  /** The session's associated attempts, oldest first. */
  attempts: readonly AnalysisAttempt[];
  /** A confirmed pattern on a different problem shares a topic and a failing
   *  verdict with this session. */
  matchesConfirmedPattern: boolean;
};

const distinct = (hashes: (string | null)[]) => new Set(hashes.filter((hash): hash is string => hash != null)).size;

/**
 * - Two or more failed submissions with distinct code, then Accepted.
 * - A failure resembling an existing confirmed pattern on another problem.
 * Each also needs code: an analysis without code can only restate verdicts.
 */
export function automaticAnalysisTrigger(input: AutomaticAnalysisInput): AutomaticAnalysisTrigger | null {
  const firstAccepted = input.attempts.findIndex((attempt) => attempt.verdict === "Accepted");
  const beforeAccepted = firstAccepted === -1 ? input.attempts : input.attempts.slice(0, firstAccepted);
  const failedWithCode = beforeAccepted.filter((attempt) => attempt.verdict !== "Accepted").map((attempt) => attempt.codeHash);

  if (firstAccepted !== -1 && distinct(failedWithCode) >= 2) return "repeated_failures";
  const anyFailedCode = input.attempts.some((attempt) => attempt.verdict !== "Accepted" && attempt.codeHash != null);
  if (input.matchesConfirmedPattern && anyFailedCode) return "pattern_recurrence";
  return null;
}

/** A manual analysis needs at least one captured submission's code. */
export function hasAnalyzableCode(attempts: readonly AnalysisAttempt[]) {
  return attempts.some((attempt) => attempt.codeHash != null);
}

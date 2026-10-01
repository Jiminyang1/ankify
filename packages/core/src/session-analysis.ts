/**
 * When a completed practice session qualifies for *automatic* analysis. These
 * are reasons to spend the user's own AI key, not diagnoses: they only say the
 * session holds a failure with code that a cause could be found in.
 */

export type AnalysisAttempt = {
  verdict: string;
  /** Hash of the submitted code; null when the code was not captured. */
  codeHash: string | null;
};

export type AutomaticAnalysisTrigger = "repeated_failures" | "pattern_recurrence" | "failed_attempt";

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
 * Any failed submission with captured code qualifies; the reason says which
 * kind: two or more distinct failed revisions before Accepted, a failure
 * resembling a confirmed pattern on another problem, or any other failure.
 * Sessions accepted without a failure, and failures without code (an analysis
 * could only restate the verdict), never qualify.
 */
export function automaticAnalysisTrigger(input: AutomaticAnalysisInput): AutomaticAnalysisTrigger | null {
  const firstAccepted = input.attempts.findIndex((attempt) => attempt.verdict === "Accepted");
  const beforeAccepted = firstAccepted === -1 ? input.attempts : input.attempts.slice(0, firstAccepted);
  const failedWithCode = beforeAccepted.filter((attempt) => attempt.verdict !== "Accepted").map((attempt) => attempt.codeHash);

  if (firstAccepted !== -1 && distinct(failedWithCode) >= 2) return "repeated_failures";
  const anyFailedCode = input.attempts.some((attempt) => attempt.verdict !== "Accepted" && attempt.codeHash != null);
  if (!anyFailedCode) return null;
  return input.matchesConfirmedPattern ? "pattern_recurrence" : "failed_attempt";
}

/** A manual analysis needs at least one captured submission's code. */
export function hasAnalyzableCode(attempts: readonly AnalysisAttempt[]) {
  return attempts.some((attempt) => attempt.codeHash != null);
}

/**
 * Which completed practice sessions an analysis can read. Automatic and manual
 * analysis share one rule, whatever the session's kind (first practice,
 * review, or practice): the session needs captured code, because an analysis
 * of verdicts alone could only restate them.
 */

export type AnalysisAttempt = {
  verdict: string;
  /** Hash of the submitted code; null when the code was not captured. */
  codeHash: string | null;
};

/** A session with at least one captured submission's code can be analyzed. */
export function hasAnalyzableCode(attempts: readonly AnalysisAttempt[]) {
  return attempts.some((attempt) => attempt.codeHash != null);
}

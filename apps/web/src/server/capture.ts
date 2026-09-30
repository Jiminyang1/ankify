import type { CaptureProblemInput, CaptureResultDto } from "@ankify/contracts";
import { getDb } from "@ankify/db";
import { markFirstCapture } from "@/server/onboarding";
import { upsertLeetcodeProblem } from "@/server/problem-upsert";
import { storeSubmissions } from "@/server/submission-store";

type CaptureOutcome =
  | CaptureResultDto
  | {
      error: "duplicate_problem_conflict" | "problem_limit_reached";
      message: string;
    };

/** Legacy capture: upsert the problem and import submissions, unassociated
 *  with any practice session. Never writes FSRS state of an existing problem. */
export async function captureProblem(
  userId: string,
  input: CaptureProblemInput,
): Promise<CaptureOutcome> {
  const { submissions, ...problemInput } = input;
  const outcome = await getDb().transaction(async (tx): Promise<CaptureOutcome> => {
    const upserted = await upsertLeetcodeProblem(tx, userId, problemInput, { enrollment: "enrolled" });
    if (!upserted.ok) return { error: upserted.error, message: upserted.message };

    const problemId = upserted.problem.id;
    const stored = await storeSubmissions(tx, userId, problemId, submissions);
    const count = (kind: (typeof stored)[number]["kind"]) =>
      stored.filter((outcome) => outcome.kind === kind).length;
    const capacityBlockedSubmissions = count("capacity_blocked");

    return {
      problemId,
      created: upserted.created,
      importedSubmissions: count("inserted"),
      submissionLimitReached: capacityBlockedSubmissions > 0,
      duplicateSubmissions: count("duplicate"),
      enrichedSubmissions: stored.filter((outcome) => outcome.kind === "duplicate" && outcome.enriched).length,
      conflictingSubmissions: count("conflict"),
      capacityBlockedSubmissions,
    };
  });

  if (!("error" in outcome) && outcome.created) {
    await markFirstCapture(userId).catch((error) => {
      console.warn("[onboarding] failed to record first capture", error);
    });
  }

  return outcome;
}

import type { CaptureProblemInput, CaptureResultDto } from "@ankify/contracts";
import { emptyCardState } from "@ankify/core";
import { getDb, schema } from "@ankify/db";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { markFirstCapture } from "@/server/onboarding";
import { MAX_PROBLEMS_PER_USER } from "@/server/resource-limits";
import { storeSubmissions } from "@/server/submission-store";

type CaptureOutcome =
  | CaptureResultDto
  | {
      error: "duplicate_problem_conflict" | "problem_limit_reached";
      message: string;
    };

export async function captureProblem(
  userId: string,
  input: CaptureProblemInput,
): Promise<CaptureOutcome> {
  const db = getDb();
  const outcome = await db.transaction(async (tx): Promise<CaptureOutcome> => {
    const existing = await tx
      .select()
      .from(schema.problems)
      .where(
        and(
          eq(schema.problems.userId, userId),
          input.leetcodeId != null
            ? or(
                eq(schema.problems.leetcodeSlug, input.leetcodeSlug),
                eq(schema.problems.leetcodeId, input.leetcodeId),
              )
            : eq(schema.problems.leetcodeSlug, input.leetcodeSlug),
        ),
      );

    if (existing.length > 1) {
      return {
        error: "duplicate_problem_conflict",
        message: "LeetCode slug and numeric id matched different existing problems.",
      };
    }

    const existingProblem = existing[0];
    if (!existingProblem) {
      const [{ count } = { count: 0 }] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(schema.problems)
        .where(and(eq(schema.problems.userId, userId), isNull(schema.problems.archivedAt)));
      if (count >= MAX_PROBLEMS_PER_USER) {
        return {
          error: "problem_limit_reached",
          message: `You've reached the limit of ${MAX_PROBLEMS_PER_USER} problems. Archive or delete some to capture more.`,
        };
      }
    }

    const problemId = existingProblem?.id ?? nanoid(12);
    const created = !existingProblem;

    if (!existingProblem) {
      const initialState = emptyCardState();
      await tx.insert(schema.problems).values({
        id: problemId,
        userId,
        leetcodeSlug: input.leetcodeSlug,
        leetcodeId: input.leetcodeId,
        title: input.title,
        difficulty: input.difficulty,
        url: input.url,
        descriptionMd: input.descriptionMd,
        topicTags: input.topicTags,
        similarSlugs: input.similarSlugs,
        notes: input.notes,
        fsrsDue: initialState.due,
        fsrsStability: initialState.stability,
        fsrsDifficulty: initialState.difficulty,
        fsrsLearningSteps: initialState.learningSteps,
        fsrsState: initialState.state,
      });
      await tx.insert(schema.reviewEvents).values({
        id: nanoid(12),
        userId,
        problemId,
        eventType: "problem_captured",
      });
    } else {
      await tx
        .update(schema.problems)
        .set({
          title: input.title,
          difficulty: input.difficulty,
          url: input.url,
          leetcodeSlug: input.leetcodeSlug,
          leetcodeId: input.leetcodeId ?? existingProblem.leetcodeId,
          descriptionMd: input.descriptionMd ?? existingProblem.descriptionMd,
          topicTags: input.topicTags,
          similarSlugs: input.similarSlugs,
          notes: input.notes ?? existingProblem.notes,
          archivedAt: null,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, userId)));
    }

    const stored = await storeSubmissions(tx, userId, problemId, input.submissions);
    const count = (kind: (typeof stored)[number]["kind"]) =>
      stored.filter((outcome) => outcome.kind === kind).length;
    const capacityBlockedSubmissions = count("capacity_blocked");

    return {
      problemId,
      created,
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

import type { CaptureProblemInput } from "@ankify/contracts";
import { emptyCardState } from "@ankify/core";
import { getDb, schema } from "@ankify/db";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { markFirstCapture } from "@/server/onboarding";
import {
  MAX_PROBLEMS_PER_USER,
  MAX_SUBMISSIONS_PER_PROBLEM,
} from "@/server/resource-limits";

type CaptureOutcome =
  | {
      problemId: string;
      created: boolean;
      importedSubmissions: number;
      submissionLimitReached: boolean;
    }
  | {
      error: "duplicate_problem_conflict" | "problem_limit_reached";
      message: string;
    };

export async function captureProblem(
  userId: string,
  input: CaptureProblemInput,
): Promise<CaptureOutcome> {
  const db = getDb();
  const submissions = input.submissions.map((submission) => ({
    id: nanoid(12),
    leetcodeSubmissionId: submission.leetcodeSubmissionId,
    language: submission.language,
    code: submission.code,
    status: submission.status,
    runtimeMs: submission.runtimeMs,
    memoryKb: submission.memoryKb,
    failedTestcase: submission.failedTestcase,
    expectedOutput: submission.expectedOutput,
    actualOutput: submission.actualOutput,
    errorMessage: submission.errorMessage,
    submittedAt: submission.submittedAt ? new Date(submission.submittedAt) : new Date(),
  }));

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

    const storedSubmissions = await tx
      .select({ leetcodeSubmissionId: schema.submissions.leetcodeSubmissionId })
      .from(schema.submissions)
      .where(
        and(
          eq(schema.submissions.problemId, problemId),
          eq(schema.submissions.userId, userId),
        ),
      );
    const availableSlots = Math.max(
      0,
      MAX_SUBMISSIONS_PER_PROBLEM - storedSubmissions.length,
    );
    const seenLeetcodeIds = new Set(
      storedSubmissions
        .map((submission) => submission.leetcodeSubmissionId)
        .filter((id): id is string => Boolean(id)),
    );
    const seenSubmissionKeys = new Set<string>();

    const incomingCodes = [...new Set(submissions.map((submission) => submission.code))];
    const storedMatches = incomingCodes.length
      ? await tx
          .select({
            language: schema.submissions.language,
            status: schema.submissions.status,
            code: schema.submissions.code,
          })
          .from(schema.submissions)
          .where(
            and(
              eq(schema.submissions.userId, userId),
              eq(schema.submissions.problemId, problemId),
              inArray(schema.submissions.code, incomingCodes),
            ),
          )
      : [];
    const storedExactKeys = new Set(storedMatches.map(exactSubmissionKey));
    const newSubmissions: Array<
      (typeof submissions)[number] & { userId: string; problemId: string }
    > = [];
    let submissionLimitReached = false;

    for (const submission of submissions) {
      const row = { ...submission, userId, problemId };
      if (row.leetcodeSubmissionId && seenLeetcodeIds.has(row.leetcodeSubmissionId)) continue;

      const key = normalizedSubmissionKey(row);
      if (seenSubmissionKeys.has(key)) continue;
      if (newSubmissions.length >= availableSlots) {
        submissionLimitReached = true;
        break;
      }
      if (storedExactKeys.has(exactSubmissionKey(row))) {
        seenSubmissionKeys.add(key);
        continue;
      }

      newSubmissions.push(row);
      if (row.leetcodeSubmissionId) seenLeetcodeIds.add(row.leetcodeSubmissionId);
      seenSubmissionKeys.add(key);
    }

    if (newSubmissions.length > 0) {
      await tx.insert(schema.submissions).values(newSubmissions);
      await tx.insert(schema.reviewEvents).values(
        newSubmissions.map((submission) => ({
          id: nanoid(12),
          userId,
          problemId,
          eventType: "submission_imported" as const,
          submissionId: submission.id,
        })),
      );
    }

    return {
      problemId,
      created,
      importedSubmissions: newSubmissions.length,
      submissionLimitReached,
    };
  });

  if (!("error" in outcome) && outcome.created) {
    await markFirstCapture(userId).catch((error) => {
      console.warn("[onboarding] failed to record first capture", error);
    });
  }

  return outcome;
}

function normalizeCode(code: string) {
  return code
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function normalizedSubmissionKey(submission: {
  language: string;
  code: string;
  status: string;
}) {
  return `${submission.language}\x00${submission.status}\x00${normalizeCode(submission.code)}`;
}

function exactSubmissionKey(submission: {
  language: string;
  code: string;
  status: string;
}) {
  return `${submission.language}\x00${submission.status}\x00${submission.code}`;
}

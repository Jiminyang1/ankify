import { NextResponse } from "next/server";
import { getDb, schema } from "@ankify/db";
import { schemas, emptyCardState } from "@ankify/core";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getRequestUser, unauthorizedResponse } from "@/lib/auth";
import { RATE_LIMITS, checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { readJsonBody } from "@/lib/request-body";
import {
  MAX_PROBLEMS_PER_USER,
  MAX_SUBMISSIONS_PER_PROBLEM,
} from "@/lib/resource-limits";

export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const limit = await checkRateLimit(user.id, "capture", RATE_LIMITS.capture);
  if (!limit.ok) return rateLimitResponse(limit.retryAfterSec);

  const body = await readJsonBody(req);
  if (!body.ok) {
    return NextResponse.json(
      { error: body.error },
      { status: body.error === "payload_too_large" ? 413 : 400 },
    );
  }

  const parsed = schemas.captureProblemSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }
  const input = parsed.data;
  const db = getDb();

  const existing = await db
    .select()
    .from(schema.problems)
    .where(
      and(
        eq(schema.problems.userId, user.id),
        input.leetcodeId != null
          ? or(
              eq(schema.problems.leetcodeSlug, input.leetcodeSlug),
              eq(schema.problems.leetcodeId, input.leetcodeId),
            )
          : eq(schema.problems.leetcodeSlug, input.leetcodeSlug),
      ),
    );

  if (new Set(existing.map((problem) => problem.id)).size > 1) {
    return NextResponse.json(
      {
        error: "duplicate_problem_conflict",
        message: "LeetCode slug and numeric id matched different existing problems.",
      },
      { status: 409 },
    );
  }

  const existingProblem = existing[0];
  let problemId = existingProblem?.id;
  let created = false;
  let importedSubmissions = 0;
  let submissionLimitReached = false;

  // Hard per-user cap on new problems (abuse floor for open signup). Only gates
  // brand-new captures — re-capturing an existing problem stays allowed.
  if (!existingProblem) {
    const [{ count } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.problems)
      .where(and(eq(schema.problems.userId, user.id), isNull(schema.problems.archivedAt)));
    if (count >= MAX_PROBLEMS_PER_USER) {
      return NextResponse.json(
        {
          error: "problem_limit_reached",
          message: `You've reached the limit of ${MAX_PROBLEMS_PER_USER} problems. Archive or delete some to capture more.`,
        },
        { status: 403 },
      );
    }
  }

  const submissionRows = input.submissions.map((s) => {
    const submittedAt = s.submittedAt ? new Date(s.submittedAt) : new Date();
    return {
      id: nanoid(12),
      problemId: "",
      leetcodeSubmissionId: s.leetcodeSubmissionId,
      language: s.language,
      code: s.code,
      status: s.status,
      runtimeMs: s.runtimeMs,
      memoryKb: s.memoryKb,
      failedTestcase: s.failedTestcase,
      expectedOutput: s.expectedOutput,
      actualOutput: s.actualOutput,
      errorMessage: s.errorMessage,
      submittedAt,
    };
  });

  await db.transaction(async (tx) => {
    if (!problemId) {
      problemId = nanoid(12);
      const init = emptyCardState();
      await tx.insert(schema.problems).values({
        id: problemId,
        userId: user.id,
        leetcodeSlug: input.leetcodeSlug,
        leetcodeId: input.leetcodeId,
        title: input.title,
        difficulty: input.difficulty,
        url: input.url,
        descriptionMd: input.descriptionMd,
        topicTags: input.topicTags,
        similarSlugs: input.similarSlugs,
        notes: input.notes,
        fsrsDue: init.due,
        fsrsStability: init.stability,
        fsrsDifficulty: init.difficulty,
        fsrsLearningSteps: init.learningSteps,
        fsrsState: init.state,
      });
      await tx.insert(schema.reviewEvents).values({
        id: nanoid(12),
        userId: user.id,
        problemId,
        eventType: "problem_captured",
      });
      created = true;
    } else {
      const ep = existingProblem!;
      await tx
        .update(schema.problems)
        .set({
          title: input.title,
          difficulty: input.difficulty,
          url: input.url,
          leetcodeSlug: input.leetcodeSlug,
          leetcodeId: input.leetcodeId ?? ep.leetcodeId,
          descriptionMd: input.descriptionMd ?? ep.descriptionMd,
          topicTags: input.topicTags,
          similarSlugs: input.similarSlugs,
          notes: input.notes ?? ep.notes,
          archivedAt: null,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.problems.id, problemId!), eq(schema.problems.userId, user.id)));
    }

    // Dedup inside the transaction without loading every stored source file
    // into the function. LeetCode's stable submission id is the primary key;
    // an exact-code lookup handles old/third-party clients that omit it.
    const existingSubmissionIds = await tx
      .select({
        leetcodeSubmissionId: schema.submissions.leetcodeSubmissionId,
      })
      .from(schema.submissions)
      .where(and(eq(schema.submissions.problemId, problemId!), eq(schema.submissions.userId, user.id)));

    const [{ count: existingSubmissionCount } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(schema.submissions)
      .where(and(eq(schema.submissions.problemId, problemId!), eq(schema.submissions.userId, user.id)));
    const availableSlots = Math.max(
      0,
      MAX_SUBMISSIONS_PER_PROBLEM - existingSubmissionCount,
    );

    const normalizedCode = (code: string) =>
      code
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n")
        .trim();

    const submissionKey = (s: {
      language: string;
      code: string;
      status: string;
    }) => `${s.language}\x00${s.status}\x00${normalizedCode(s.code)}`;

    const seenLeetcodeIds = new Set(
      existingSubmissionIds
        .map((s) => s.leetcodeSubmissionId)
        .filter((id): id is string => Boolean(id)),
    );
    const seenSubmissionKeys = new Set<string>();
    const pid = problemId!;
    const newRows: Array<(typeof submissionRows)[number] & { userId: string; problemId: string }> = [];
    for (const row of submissionRows.map((submission) => ({ ...submission, userId: user.id, problemId: pid }))) {
      if (row.leetcodeSubmissionId && seenLeetcodeIds.has(row.leetcodeSubmissionId)) continue;

      const key = submissionKey(row);
      if (seenSubmissionKeys.has(key)) continue;
      if (newRows.length >= availableSlots) {
        submissionLimitReached = true;
        break;
      }

      const [sameSubmission] = await tx
        .select({ id: schema.submissions.id })
        .from(schema.submissions)
        .where(
          and(
            eq(schema.submissions.userId, user.id),
            eq(schema.submissions.problemId, pid),
            eq(schema.submissions.language, row.language),
            eq(schema.submissions.status, row.status),
            eq(schema.submissions.code, row.code),
          ),
        )
        .limit(1);
      if (sameSubmission) {
        seenSubmissionKeys.add(key);
        continue;
      }

      newRows.push(row);
      if (row.leetcodeSubmissionId) seenLeetcodeIds.add(row.leetcodeSubmissionId);
      seenSubmissionKeys.add(key);
    }

    if (newRows.length > 0) {
      await tx.insert(schema.submissions).values(newRows);
      importedSubmissions = newRows.length;
      await tx.insert(schema.reviewEvents).values(
        newRows.map((row) => ({
          id: nanoid(12),
          userId: user.id,
          problemId: pid,
          eventType: "submission_imported" as const,
          submissionId: row.id,
        })),
      );
    }
  });

  return NextResponse.json({
    problemId,
    created,
    importedSubmissions,
    submissionLimitReached,
  });
}

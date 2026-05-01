import { NextResponse } from "next/server";
import { getDb, schema } from "@ankify/db";
import { schemas, emptyCardState } from "@ankify/core";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

/** Chrome extension hits this. Idempotent on leetcode_slug — repeats add new
 * submissions but reuse the existing problem. Also seeds the FSRS "new" state.
 * Auth is enforced globally by `apps/web/src/middleware.ts`. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schemas.captureProblemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }
  const input = parsed.data;
  const db = getDb();

  const existing = await db
    .select()
    .from(schema.problems)
    .where(eq(schema.problems.leetcodeSlug, input.leetcodeSlug));

  let problemId = existing[0]?.id;
  let created = false;

  if (!problemId) {
    problemId = nanoid(12);
    const init = emptyCardState();
    await db.insert(schema.problems).values({
      id: problemId,
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
      fsrsState: init.state,
    });
    await db.insert(schema.reviewEvents).values({
      id: nanoid(12),
      problemId,
      eventType: "card_created",
    });
    created = true;
  } else {
    await db
      .update(schema.problems)
      .set({
        title: input.title,
        difficulty: input.difficulty,
        url: input.url,
        descriptionMd: input.descriptionMd ?? existing[0]!.descriptionMd,
        topicTags: input.topicTags,
        similarSlugs: input.similarSlugs,
        notes: input.notes ?? existing[0]!.notes,
        updatedAt: new Date(),
      })
      .where(eq(schema.problems.id, problemId));
  }

  const submissionRows = input.submissions.map((s) => ({
    id: nanoid(12),
    problemId,
    language: s.language,
    code: s.code,
    status: s.status,
    runtimeMs: s.runtimeMs,
    memoryKb: s.memoryKb,
    failedTestcase: s.failedTestcase,
    expectedOutput: s.expectedOutput,
    actualOutput: s.actualOutput,
    errorMessage: s.errorMessage,
    submittedAt: s.submittedAt ? new Date(s.submittedAt) : new Date(),
  }));

  if (submissionRows.length > 0) {
    await db.insert(schema.submissions).values(submissionRows);
    await db.insert(schema.reviewEvents).values(
      submissionRows.map((row) => ({
        id: nanoid(12),
        problemId,
        eventType: "submission_imported" as const,
        submissionId: row.id,
      })),
    );
  }

  return NextResponse.json({
    problemId,
    created,
    submissionIds: submissionRows.map((r) => r.id),
  });
}

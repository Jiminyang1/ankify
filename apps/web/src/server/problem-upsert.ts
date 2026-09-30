import type { CaptureProblemInput } from "@ankify/contracts";
import { emptyCardState } from "@ankify/core";
import { getDb, schema, type Problem } from "@ankify/db";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { MAX_PROBLEMS_PER_USER } from "@/server/resource-limits";
import { recordSimilarQuestions } from "@/server/suggestions/candidates";

type DbTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** LeetCode metadata for a problem, as captured by the extension. */
export type LeetcodeProblemInput = Omit<CaptureProblemInput, "submissions" | "notes"> & { notes?: string };

export type ProblemLookup =
  | { kind: "found"; problem: Problem }
  | { kind: "missing" }
  /** Slug and numeric id matched two different problems. */
  | { kind: "conflict" };

export type ProblemUpsertResult =
  | { ok: true; problem: Problem; created: boolean; unarchived: boolean }
  | { ok: false; error: "duplicate_problem_conflict" | "problem_limit_reached"; message: string };

export async function findLeetcodeProblem(
  tx: DbTransaction,
  userId: string,
  input: Pick<LeetcodeProblemInput, "leetcodeSlug" | "leetcodeId">,
): Promise<ProblemLookup> {
  const p = schema.problems;
  const rows = await tx
    .select()
    .from(p)
    .where(
      and(
        eq(p.userId, userId),
        input.leetcodeId != null
          ? or(eq(p.leetcodeSlug, input.leetcodeSlug), eq(p.leetcodeId, input.leetcodeId))
          : eq(p.leetcodeSlug, input.leetcodeSlug),
      ),
    );
  if (rows.length > 1) return { kind: "conflict" };
  return rows[0] ? { kind: "found", problem: rows[0] } : { kind: "missing" };
}

/**
 * Creates the problem, or refreshes an existing one's LeetCode metadata and
 * unarchives it. Notes, enrollment, and FSRS state of an existing problem are
 * never rewritten. A new problem starts `enrolled` and due now (legacy
 * capture) or `awaiting_initial` and unscheduled (a practice session's
 * initial learning schedules it on completion).
 */
export async function upsertLeetcodeProblem(
  tx: DbTransaction,
  userId: string,
  input: LeetcodeProblemInput,
  options: { enrollment: "enrolled" | "awaiting_initial"; now?: Date },
): Promise<ProblemUpsertResult> {
  const now = options.now ?? new Date();
  const result = await upsertProblemRow(tx, userId, input, options.enrollment, now);
  // Verified similar questions become suggestion candidates, with the problem.
  if (result.ok) await recordSimilarQuestions(tx, userId, input.similarQuestions ?? [], now);
  return result;
}

async function upsertProblemRow(
  tx: DbTransaction,
  userId: string,
  input: LeetcodeProblemInput,
  enrollment: "enrolled" | "awaiting_initial",
  now: Date,
): Promise<ProblemUpsertResult> {
  const p = schema.problems;
  const lookup = await findLeetcodeProblem(tx, userId, input);
  if (lookup.kind === "conflict") {
    return {
      ok: false,
      error: "duplicate_problem_conflict",
      message: "LeetCode slug and numeric id matched different existing problems.",
    };
  }

  if (lookup.kind === "found") {
    const existing = lookup.problem;
    const [problem] = await tx
      .update(p)
      .set({
        title: input.title,
        difficulty: input.difficulty,
        url: input.url,
        leetcodeSlug: input.leetcodeSlug,
        leetcodeId: input.leetcodeId ?? existing.leetcodeId,
        descriptionMd: input.descriptionMd ?? existing.descriptionMd,
        topicTags: input.topicTags,
        similarSlugs: input.similarSlugs,
        notes: input.notes ?? existing.notes,
        archivedAt: null,
        updatedAt: now,
      })
      .where(and(eq(p.id, existing.id), eq(p.userId, userId)))
      .returning();
    return { ok: true, problem: problem!, created: false, unarchived: existing.archivedAt != null };
  }

  const [{ count } = { count: 0 }] = await tx
    .select({ count: sql<number>`count(*)` })
    .from(p)
    .where(and(eq(p.userId, userId), isNull(p.archivedAt)));
  if (count >= MAX_PROBLEMS_PER_USER) {
    return {
      ok: false,
      error: "problem_limit_reached",
      message: `You've reached the limit of ${MAX_PROBLEMS_PER_USER} problems. Archive or delete some to capture more.`,
    };
  }

  const initialState = emptyCardState(now);
  const [problem] = await tx
    .insert(p)
    .values({
      id: nanoid(12),
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
      enrollment,
      fsrsDue: enrollment === "enrolled" ? initialState.due : null,
      fsrsStability: initialState.stability,
      fsrsDifficulty: initialState.difficulty,
      fsrsLearningSteps: initialState.learningSteps,
      fsrsState: initialState.state,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  await tx.insert(schema.reviewEvents).values({
    id: nanoid(12),
    userId,
    problemId: problem!.id,
    eventType: "problem_captured",
    occurredAt: now,
  });
  return { ok: true, problem: problem!, created: true, unarchived: false };
}

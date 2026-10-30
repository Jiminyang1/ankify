import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  WEAKNESS_DETAIL_MAX,
  WEAKNESS_EVIDENCE_MAX,
  computeWeaknessProfile,
  findDuplicateWeakness,
  isBuiltinWeaknessCategory,
} from "@ankify/core";
import type { WeaknessDto, WeaknessProfileDto } from "@ankify/contracts";
import { getDb, schema, type Weakness, type WeaknessEvidence } from "@ankify/db";

/**
 * Weaknesses (docs/coach-practice.md, version 2). The Coach records them with
 * evidence; these rules keep the record honest: the category must exist, the
 * evidence must belong to this problem, and a repeat of an active weakness
 * bumps it instead of adding a row.
 */

export type RecordWeaknessError = "problem_not_found" | "unknown_category" | "invalid_evidence" | "empty_detail";

export type RecordWeaknessResult =
  | { ok: true; weakness: WeaknessDto; merged: boolean }
  | { ok: false; error: RecordWeaknessError };

async function customCategories(userId: string) {
  return getDb()
    .select({
      key: schema.weaknessCategories.key,
      name: schema.weaknessCategories.name,
      description: schema.weaknessCategories.description,
    })
    .from(schema.weaknessCategories)
    .where(eq(schema.weaknessCategories.userId, userId));
}

export function toWeaknessDto(weakness: Weakness, customNames: Map<string, string>): WeaknessDto {
  return {
    id: weakness.id,
    problemId: weakness.problemId,
    category: weakness.category,
    categoryName: customNames.get(weakness.category) ?? null,
    detail: weakness.detail,
    evidence: weakness.evidenceJson,
    status: weakness.status,
    hitCount: weakness.hitCount,
    firstSeenAt: weakness.firstSeenAt.toISOString(),
    lastSeenAt: weakness.lastSeenAt.toISOString(),
    resolvedAt: weakness.resolvedAt?.toISOString() ?? null,
  };
}

async function validEvidence(userId: string, problemId: string, evidence: WeaknessEvidence[]) {
  const db = getDb();
  const submissionIds = evidence.filter((item) => item.kind === "submission").map((item) => item.ref);
  const practiceIds = evidence.filter((item) => item.kind === "practice").map((item) => item.ref);
  const [submissions, practice] = await Promise.all([
    submissionIds.length
      ? db
          .select({ id: schema.submissions.id })
          .from(schema.submissions)
          .where(
            and(
              eq(schema.submissions.userId, userId),
              eq(schema.submissions.problemId, problemId),
              inArray(schema.submissions.id, submissionIds),
            ),
          )
      : Promise.resolve([]),
    practiceIds.length
      ? db
          .select({ id: schema.practiceSessions.id })
          .from(schema.practiceSessions)
          .where(
            and(
              eq(schema.practiceSessions.userId, userId),
              eq(schema.practiceSessions.problemId, problemId),
              inArray(schema.practiceSessions.id, practiceIds),
            ),
          )
      : Promise.resolve([]),
  ]);
  return (
    submissions.length === new Set(submissionIds).size && practice.length === new Set(practiceIds).size
  );
}

export async function recordWeakness(
  userId: string,
  input: {
    problemId: string;
    category: string;
    detail: string;
    /** Submissions and practice sessions this mistake showed up in. */
    evidence: WeaknessEvidence[];
    /** The Coach run that found it; recorded as conversation evidence. */
    runId: string | null;
  },
): Promise<RecordWeaknessResult> {
  const db = getDb();
  const detail = input.detail.replace(/\s+/g, " ").trim().slice(0, WEAKNESS_DETAIL_MAX);
  if (!detail) return { ok: false, error: "empty_detail" };

  const [problem] = await db
    .select({ id: schema.problems.id })
    .from(schema.problems)
    .where(and(eq(schema.problems.id, input.problemId), eq(schema.problems.userId, userId)))
    .limit(1);
  if (!problem) return { ok: false, error: "problem_not_found" };

  const custom = await customCategories(userId);
  if (!isBuiltinWeaknessCategory(input.category) && !custom.some((category) => category.key === input.category)) {
    return { ok: false, error: "unknown_category" };
  }
  if (!(await validEvidence(userId, input.problemId, input.evidence))) return { ok: false, error: "invalid_evidence" };

  const evidence: WeaknessEvidence[] = [
    ...input.evidence,
    ...(input.runId ? [{ kind: "conversation" as const, ref: input.runId }] : []),
  ];
  const customNames = new Map(custom.map((category) => [category.key, category.name]));
  const now = new Date();

  const existing = await db
    .select()
    .from(schema.weaknesses)
    .where(
      and(
        eq(schema.weaknesses.userId, userId),
        eq(schema.weaknesses.problemId, input.problemId),
        ne(schema.weaknesses.status, "dismissed"),
      ),
    );
  const duplicate = findDuplicateWeakness(existing, input.category, detail);
  if (duplicate) {
    const merged = [...duplicate.evidenceJson, ...evidence].filter(
      (item, index, all) => all.findIndex((other) => other.kind === item.kind && other.ref === item.ref) === index,
    );
    const [updated] = await db
      .update(schema.weaknesses)
      .set({
        // A recurrence reopens a resolved weakness.
        status: "active",
        resolvedAt: null,
        correctStreak: 0,
        hitCount: duplicate.hitCount + 1,
        evidenceJson: merged.slice(-WEAKNESS_EVIDENCE_MAX),
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(eq(schema.weaknesses.id, duplicate.id))
      .returning();
    return { ok: true, weakness: toWeaknessDto(updated!, customNames), merged: true };
  }

  const [created] = await db
    .insert(schema.weaknesses)
    .values({
      id: nanoid(16),
      userId,
      problemId: input.problemId,
      category: input.category,
      detail,
      evidenceJson: evidence.slice(-WEAKNESS_EVIDENCE_MAX),
      firstSeenAt: now,
      lastSeenAt: now,
      updatedAt: now,
    })
    .returning();
  return { ok: true, weakness: toWeaknessDto(created!, customNames), merged: false };
}

/** A problem's weaknesses: active first, then resolved. Dismissed ones are hidden. */
export async function listProblemWeaknesses(userId: string, problemId: string): Promise<WeaknessDto[]> {
  const [rows, custom] = await Promise.all([
    getDb()
      .select()
      .from(schema.weaknesses)
      .where(
        and(
          eq(schema.weaknesses.userId, userId),
          eq(schema.weaknesses.problemId, problemId),
          ne(schema.weaknesses.status, "dismissed"),
        ),
      )
      .orderBy(desc(schema.weaknesses.lastSeenAt)),
    customCategories(userId),
  ]);
  const names = new Map(custom.map((category) => [category.key, category.name]));
  return rows
    .sort((a, b) => Number(a.status !== "active") - Number(b.status !== "active"))
    .map((row) => toWeaknessDto(row, names));
}

export async function setWeaknessStatus(
  userId: string,
  weaknessId: string,
  status: "active" | "resolved" | "dismissed",
): Promise<WeaknessDto | null> {
  const now = new Date();
  const [updated] = await getDb()
    .update(schema.weaknesses)
    .set({
      status,
      resolvedAt: status === "resolved" ? now : null,
      correctStreak: 0,
      updatedAt: now,
    })
    .where(and(eq(schema.weaknesses.id, weaknessId), eq(schema.weaknesses.userId, userId)))
    .returning();
  if (!updated) return null;
  const custom = await customCategories(userId);
  return toWeaknessDto(updated, new Map(custom.map((category) => [category.key, category.name])));
}

/** Adds an approved custom category. A key that already exists is kept as is. */
export async function addWeaknessCategory(
  userId: string,
  category: { key: string; name: string; description: string },
): Promise<"added" | "exists"> {
  if (isBuiltinWeaknessCategory(category.key)) return "exists";
  const inserted = await getDb()
    .insert(schema.weaknessCategories)
    .values({ id: nanoid(16), userId, ...category })
    .onConflictDoNothing()
    .returning({ id: schema.weaknessCategories.id });
  return inserted.length ? "added" : "exists";
}

/** Every active weakness with its problem and category name, most often
 *  seen first: the Plan page groups them by chapter. */
export async function loadActiveWeaknesses(userId: string) {
  const db = getDb();
  const [rows, custom] = await Promise.all([
    db
      .select({
        id: schema.weaknesses.id,
        problemId: schema.weaknesses.problemId,
        category: schema.weaknesses.category,
        detail: schema.weaknesses.detail,
        status: schema.weaknesses.status,
        hitCount: schema.weaknesses.hitCount,
        lastSeenAt: schema.weaknesses.lastSeenAt,
        resolvedAt: schema.weaknesses.resolvedAt,
        title: schema.problems.title,
        slug: schema.problems.leetcodeSlug,
      })
      .from(schema.weaknesses)
      .innerJoin(
        schema.problems,
        and(eq(schema.problems.id, schema.weaknesses.problemId), eq(schema.problems.userId, userId)),
      )
      .where(and(eq(schema.weaknesses.userId, userId), eq(schema.weaknesses.status, "active")))
      .orderBy(desc(schema.weaknesses.hitCount), desc(schema.weaknesses.lastSeenAt)),
    customCategories(userId),
  ]);
  const names = new Map(custom.map((category) => [category.key, category.name]));
  return rows.map((row) => ({ ...row, categoryName: names.get(row.category) ?? null }));
}

/** Weaknesses across problems, ranked by category. */
export async function loadWeaknessProfile(userId: string): Promise<WeaknessProfileDto> {
  const db = getDb();
  const [rows, custom] = await Promise.all([
    db
      .select({
        problemId: schema.weaknesses.problemId,
        category: schema.weaknesses.category,
        status: schema.weaknesses.status,
        hitCount: schema.weaknesses.hitCount,
        lastSeenAt: schema.weaknesses.lastSeenAt,
        resolvedAt: schema.weaknesses.resolvedAt,
      })
      .from(schema.weaknesses)
      .where(eq(schema.weaknesses.userId, userId)),
    customCategories(userId),
  ]);
  const profile = computeWeaknessProfile(rows);
  const problemIds = [...new Set(profile.flatMap((entry) => entry.problemIds))];
  const problems = problemIds.length
    ? await db
        .select({ id: schema.problems.id, title: schema.problems.title, leetcodeSlug: schema.problems.leetcodeSlug })
        .from(schema.problems)
        .where(and(eq(schema.problems.userId, userId), inArray(schema.problems.id, problemIds)))
    : [];
  const byId = new Map(problems.map((problem) => [problem.id, problem]));
  const names = new Map(custom.map((category) => [category.key, category.name]));
  return {
    categories: profile.map(({ problemIds: ids, ...entry }) => ({
      ...entry,
      categoryName: names.get(entry.category) ?? null,
      problems: ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
    })),
    customCategories: custom,
  };
}

import type { AttemptHistoryCoverageDto, AttemptHistoryMergeInput, AttemptStatus } from "@ankify/contracts";
import { getDb, schema, type AttemptHistoryCoverage } from "@ankify/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { DbTransaction } from "../practice-sessions/store";

type Db = ReturnType<typeof getDb> | DbTransaction;

/** Rows per insert statement, well under SQLite's bound-parameter limit. */
const CHUNK = 100;

function toCoverageDto(row: AttemptHistoryCoverage): AttemptHistoryCoverageDto {
  return {
    scope: row.scope,
    sourceAccount: row.sourceAccount,
    read: row.read,
    total: row.total,
    complete: row.complete,
    syncedAt: row.syncedAt.toISOString(),
  };
}

type HistoryRow = { slug: string; status: AttemptStatus };

/** Inserts or refreshes one source's entries; an accepted status never
 *  goes back to attempted. */
export async function recordAttempts(
  tx: DbTransaction,
  userId: string,
  source: "leetcode_status" | "user_marked" | "deleted_problem",
  sourceAccount: string | null,
  entries: readonly HistoryRow[],
  now: Date,
) {
  const h = schema.attemptHistory;
  const merged = new Map<string, AttemptStatus>();
  for (const entry of entries) {
    if (merged.get(entry.slug) !== "accepted") merged.set(entry.slug, entry.status);
  }
  const rows = [...merged].map(([slug, status]) => ({
    id: nanoid(12),
    userId,
    slug,
    status,
    source,
    sourceAccount,
    observedAt: now,
    createdAt: now,
    updatedAt: now,
  }));
  for (let index = 0; index < rows.length; index += CHUNK) {
    await tx
      .insert(h)
      .values(rows.slice(index, index + CHUNK))
      .onConflictDoUpdate({
        target: [h.userId, h.slug, h.source],
        set: {
          status: sql`case when ${h.status} = 'accepted' then 'accepted' else excluded.status end`,
          sourceAccount: sql`excluded.source_account`,
          observedAt: sql`excluded.observed_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
  return rows.length;
}

/**
 * Merges attempted problems read from LeetCode (or stated by the user) into
 * the user's history, with the read's coverage, in one transaction.
 */
export async function mergeAttemptHistory(userId: string, input: AttemptHistoryMergeInput, now = new Date()) {
  return getDb().transaction(async (tx) => {
    const merged = await recordAttempts(tx, userId, input.source, input.sourceAccount, input.entries, now);
    if (!input.coverage || input.sourceAccount === null) return { merged, coverage: null };
    const c = schema.attemptHistoryCoverage;
    const [coverage] = await tx
      .insert(c)
      .values({
        id: nanoid(12),
        userId,
        scope: input.coverage.scope,
        sourceAccount: input.sourceAccount,
        read: input.coverage.read,
        total: input.coverage.total,
        complete: input.coverage.complete,
        syncedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [c.userId, c.scope, c.sourceAccount],
        set: {
          read: input.coverage.read,
          total: input.coverage.total,
          complete: input.coverage.complete,
          syncedAt: now,
          updatedAt: now,
        },
      })
      .returning();
    return { merged, coverage: toCoverageDto(coverage!) };
  });
}

/**
 * Keeps a problem's slug in the history before the problem is deleted, so
 * deleting it never makes it look new. Accepted when any submission or
 * session observation of it was accepted.
 */
export async function recordDeletedProblem(tx: DbTransaction, userId: string, problemId: string, now: Date) {
  const p = schema.problems;
  const [problem] = await tx
    .select({ slug: p.leetcodeSlug })
    .from(p)
    .where(and(eq(p.id, problemId), eq(p.userId, userId)))
    .limit(1);
  if (!problem) return false;
  const s = schema.submissions;
  const o = schema.practiceSessionSubmissions;
  const [submission, observation] = await Promise.all([
    tx.select({ id: s.id }).from(s).where(and(eq(s.userId, userId), eq(s.problemId, problemId), eq(s.status, "Accepted"))).limit(1),
    tx.select({ id: o.id }).from(o).where(and(eq(o.userId, userId), eq(o.problemId, problemId), eq(o.verdict, "Accepted"))).limit(1),
  ]);
  const status = submission.length > 0 || observation.length > 0 ? "accepted" : "attempted";
  await recordAttempts(tx, userId, "deleted_problem", null, [{ slug: problem.slug, status }], now);
  return true;
}

/**
 * Every slug the user is known to have attempted: their problems (archived
 * ones too) and the attempt history. Suggestions never target these.
 */
export async function loadKnownAttemptedSlugs(db: Db, userId: string) {
  const [problems, history] = await Promise.all([
    db.select({ slug: schema.problems.leetcodeSlug }).from(schema.problems).where(eq(schema.problems.userId, userId)),
    db.select({ slug: schema.attemptHistory.slug }).from(schema.attemptHistory).where(eq(schema.attemptHistory.userId, userId)),
  ]);
  return new Set([...problems, ...history].map((row) => row.slug));
}

/** Coverage older than this no longer vouches for a problem being new. */
const COVERAGE_FRESH_MS = 30 * 86_400_000;

/**
 * "No prior attempt found" needs a LeetCode account whose accepted and tried
 * problem lists were both read to the end within the last 30 days; anything
 * less is unverified.
 */
export async function historyNovelty(db: Db, userId: string, now: Date): Promise<"no_prior_attempt_found" | "unverified"> {
  const c = schema.attemptHistoryCoverage;
  const rows = await db
    .select({ scope: c.scope, sourceAccount: c.sourceAccount })
    .from(c)
    .where(and(eq(c.userId, userId), eq(c.complete, true), gte(c.syncedAt, new Date(now.getTime() - COVERAGE_FRESH_MS))));
  const scopes = new Map<string, Set<string>>();
  for (const row of rows) scopes.set(row.sourceAccount, (scopes.get(row.sourceAccount) ?? new Set()).add(row.scope));
  return [...scopes.values()].some((set) => set.has("problem_list_accepted") && set.has("problem_list_tried"))
    ? "no_prior_attempt_found"
    : "unverified";
}

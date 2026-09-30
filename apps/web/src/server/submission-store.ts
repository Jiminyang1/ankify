import type { CaptureSubmissionInput } from "@ankify/contracts";
import { getDb, schema } from "@ankify/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { MAX_SUBMISSIONS_PER_PROBLEM } from "@/server/resource-limits";

type DbTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** What happened to one incoming submission, in input order. */
export type StoredSubmissionOutcome =
  | { kind: "inserted"; submissionId: string }
  | { kind: "duplicate"; submissionId: string; enriched: boolean }
  /** The LeetCode submission id is already stored under another problem. */
  | { kind: "conflict" }
  | { kind: "capacity_blocked" };

/** Optional detail columns a later delivery may fill in; never overwritten. */
const ENRICHABLE = [
  "runtimeMs",
  "memoryKb",
  "failedTestcase",
  "expectedOutput",
  "actualOutput",
  "errorMessage",
] as const;
type EnrichableColumn = (typeof ENRICHABLE)[number];
type DetailPatch = Partial<Pick<typeof schema.submissions.$inferInsert, EnrichableColumn>>;

/**
 * Stores captured submissions for one problem inside the caller's transaction.
 *
 * Identity: a LeetCode submission id is the identity of an attempt, so two
 * attempts with identical code stay distinct. Repeated delivery of a stored id
 * only fills in details that were missing. An id stored under another problem
 * is a conflict and is never reassigned. Payloads without an id (clients older
 * than id capture) keep the conservative content-based deduplication. Each new
 * row also appends a `submission_imported` event. No FSRS state is touched.
 */
export async function storeSubmissions(
  tx: DbTransaction,
  userId: string,
  problemId: string,
  incoming: readonly CaptureSubmissionInput[],
  now = new Date(),
): Promise<StoredSubmissionOutcome[]> {
  if (incoming.length === 0) return [];
  const s = schema.submissions;

  const incomingIds = [...new Set(incoming.flatMap((item) => (item.leetcodeSubmissionId ? [item.leetcodeSubmissionId] : [])))];
  const storedIdentified = incomingIds.length
    ? await tx
        .select({
          id: s.id,
          problemId: s.problemId,
          leetcodeSubmissionId: s.leetcodeSubmissionId,
          runtimeMs: s.runtimeMs,
          memoryKb: s.memoryKb,
          failedTestcase: s.failedTestcase,
          expectedOutput: s.expectedOutput,
          actualOutput: s.actualOutput,
          errorMessage: s.errorMessage,
        })
        .from(s)
        .where(and(eq(s.userId, userId), inArray(s.leetcodeSubmissionId, incomingIds)))
    : [];
  const storedById = new Map(storedIdentified.map((row) => [row.leetcodeSubmissionId!, row]));

  const idlessCodes = [...new Set(incoming.flatMap((item) => (item.leetcodeSubmissionId ? [] : [item.code])))];
  const storedContent = idlessCodes.length
    ? await tx
        .select({ id: s.id, language: s.language, status: s.status, code: s.code })
        .from(s)
        .where(and(eq(s.userId, userId), eq(s.problemId, problemId), inArray(s.code, idlessCodes)))
    : [];
  const storedByExactContent = new Map(storedContent.map((row) => [exactContentKey(row), row.id]));

  const [{ count: storedCount } = { count: 0 }] = await tx
    .select({ count: sql<number>`count(*)` })
    .from(s)
    .where(and(eq(s.userId, userId), eq(s.problemId, problemId)));
  const availableSlots = Math.max(0, MAX_SUBMISSIONS_PER_PROBLEM - storedCount);

  const outcomes: StoredSubmissionOutcome[] = [];
  const insertedById = new Map<string, string>();
  // Normalized content seen in this batch (inserted, or matching a stored row
  // exactly), mirroring the legacy within-batch rule for id-less payloads.
  const seenByContent = new Map<string, string>();
  const rows: (typeof s.$inferInsert)[] = [];
  const enrichments = new Map<string, DetailPatch>();

  for (const item of incoming) {
    const lcId = item.leetcodeSubmissionId;
    if (lcId) {
      const repeated = insertedById.get(lcId);
      if (repeated) {
        outcomes.push({ kind: "duplicate", submissionId: repeated, enriched: false });
        continue;
      }
      const stored = storedById.get(lcId);
      if (stored) {
        if (stored.problemId !== problemId) {
          outcomes.push({ kind: "conflict" });
          continue;
        }
        const patch = missingDetails(stored, item, enrichments.get(stored.id));
        if (patch) enrichments.set(stored.id, { ...enrichments.get(stored.id), ...patch });
        outcomes.push({ kind: "duplicate", submissionId: stored.id, enriched: patch != null });
        continue;
      }
    } else {
      const contentKey = normalizedContentKey(item);
      const repeated = seenByContent.get(contentKey) ?? storedByExactContent.get(exactContentKey(item));
      if (repeated) {
        seenByContent.set(contentKey, repeated);
        outcomes.push({ kind: "duplicate", submissionId: repeated, enriched: false });
        continue;
      }
    }

    if (rows.length >= availableSlots) {
      outcomes.push({ kind: "capacity_blocked" });
      continue;
    }
    const id = nanoid(12);
    rows.push({
      id,
      userId,
      problemId,
      leetcodeSubmissionId: lcId,
      language: item.language,
      code: item.code,
      status: item.status,
      runtimeMs: item.runtimeMs,
      memoryKb: item.memoryKb,
      failedTestcase: item.failedTestcase,
      expectedOutput: item.expectedOutput,
      actualOutput: item.actualOutput,
      errorMessage: item.errorMessage,
      submittedAt: item.submittedAt ? new Date(item.submittedAt) : now,
    });
    if (lcId) insertedById.set(lcId, id);
    if (!seenByContent.has(normalizedContentKey(item))) seenByContent.set(normalizedContentKey(item), id);
    outcomes.push({ kind: "inserted", submissionId: id });
  }

  for (const [id, patch] of enrichments) {
    await tx.update(s).set(patch).where(and(eq(s.id, id), eq(s.userId, userId)));
  }
  if (rows.length > 0) {
    await tx.insert(s).values(rows);
    await tx.insert(schema.reviewEvents).values(
      rows.map((row) => ({
        id: nanoid(12),
        userId,
        problemId,
        eventType: "submission_imported" as const,
        submissionId: row.id,
      })),
    );
  }
  return outcomes;
}

function missingDetails(
  stored: Record<EnrichableColumn, string | number | null>,
  item: CaptureSubmissionInput,
  pending: DetailPatch | undefined,
): DetailPatch | null {
  const patch: Record<string, string | number> = {};
  for (const column of ENRICHABLE) {
    const value = item[column];
    if (stored[column] == null && pending?.[column] == null && value != null) patch[column] = value;
  }
  return Object.keys(patch).length > 0 ? (patch as DetailPatch) : null;
}

function normalizeCode(code: string) {
  return code
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function normalizedContentKey(submission: { language: string; code: string; status: string }) {
  return `${submission.language}\x00${submission.status}\x00${normalizeCode(submission.code)}`;
}

function exactContentKey(submission: { language: string; code: string; status: string }) {
  return `${submission.language}\x00${submission.status}\x00${submission.code}`;
}

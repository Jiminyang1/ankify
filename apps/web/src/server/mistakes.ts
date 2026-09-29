import type {
  MistakeCreateInput,
  MistakeCreateResponseDto,
  MistakeListPayloadDto,
  MistakeListQuery,
  MistakePatchInput,
  MistakeRecordDto,
} from "@ankify/contracts";
import { getDb, schema, type MistakeRecord } from "@ankify/db";
import { and, desc, eq, lt, ne, or, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";

type MistakeSource = {
  submissionId: string | null;
  quizSessionId: string | null;
  quizItemId: string | null;
  reviewEventId: string | null;
};

type CreateMistakeResult =
  | MistakeCreateResponseDto
  | { ok: false; error: "problem_not_found" | "source_not_found" | "mistake_request_conflict" };

type UpdateMistakeResult =
  | { ok: true; mistake: MistakeRecordDto }
  | { ok: false; error: "mistake_not_found" | "duplicate_mistake" | "invalid_status_transition" };

type DbTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

const NO_SOURCE: MistakeSource = {
  submissionId: null,
  quizSessionId: null,
  quizItemId: null,
  reviewEventId: null,
};

export class InvalidMistakesCursorError extends Error {}

export function toMistakeDto(row: MistakeRecord): MistakeRecordDto {
  return {
    id: row.id,
    problemId: row.problemId,
    primaryCategory: row.primaryCategory,
    secondaryTags: row.secondaryTags,
    summary: row.summary,
    nextStep: row.nextStep,
    sourceType: row.sourceType,
    submissionId: row.submissionId,
    quizSessionId: row.quizSessionId,
    quizItemId: row.quizItemId,
    reviewEventId: row.reviewEventId,
    status: row.status,
    origin: row.origin,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function optionalText(value: string | null | undefined) {
  return value ? value : null;
}

/**
 * Checks that the referenced evidence belongs to the same user *and* problem,
 * and returns the columns to store. `null` means the reference is forged,
 * foreign, or points at another problem.
 */
async function resolveSource(
  tx: DbTransaction,
  userId: string,
  input: MistakeCreateInput,
): Promise<MistakeSource | null> {
  switch (input.sourceType) {
    case "manual":
      return NO_SOURCE;
    case "submission": {
      const [submission] = await tx
        .select({ id: schema.submissions.id })
        .from(schema.submissions)
        .where(
          and(
            eq(schema.submissions.id, input.submissionId),
            eq(schema.submissions.userId, userId),
            eq(schema.submissions.problemId, input.problemId),
          ),
        )
        .limit(1);
      return submission ? { ...NO_SOURCE, submissionId: submission.id } : null;
    }
    case "quiz_answer": {
      const [session] = await tx
        .select({
          id: schema.quizSessions.id,
          itemsJson: schema.quizSessions.itemsJson,
          answersJson: schema.quizSessions.answersJson,
        })
        .from(schema.quizSessions)
        .where(
          and(
            eq(schema.quizSessions.id, input.quizSessionId),
            eq(schema.quizSessions.userId, userId),
            eq(schema.quizSessions.problemId, input.problemId),
          ),
        )
        .limit(1);
      if (!session) return null;
      const itemExists = session.itemsJson.some((item) => item.id === input.quizItemId);
      const answered = session.answersJson.some((answer) => answer.itemId === input.quizItemId);
      return itemExists && answered
        ? { ...NO_SOURCE, quizSessionId: session.id, quizItemId: input.quizItemId }
        : null;
    }
    case "review": {
      const [event] = await tx
        .select({ id: schema.reviewEvents.id })
        .from(schema.reviewEvents)
        .where(
          and(
            eq(schema.reviewEvents.userId, userId),
            eq(schema.reviewEvents.requestId, input.reviewRequestId),
            eq(schema.reviewEvents.problemId, input.problemId),
            eq(schema.reviewEvents.eventType, "self_recall_rated"),
          ),
        )
        .limit(1);
      return event ? { ...NO_SOURCE, reviewEventId: event.id } : null;
    }
  }
}

/** Condition matching live (non-dismissed) records of one source, mirroring
 *  the partial unique dedupe indexes. `undefined` for manual records. */
function sameSourceCondition(source: MistakeSource): SQL | undefined {
  const r = schema.mistakeRecords;
  if (source.submissionId) return eq(r.submissionId, source.submissionId);
  if (source.quizSessionId && source.quizItemId) {
    return and(eq(r.quizSessionId, source.quizSessionId), eq(r.quizItemId, source.quizItemId));
  }
  if (source.reviewEventId) return eq(r.reviewEventId, source.reviewEventId);
  return undefined;
}

export async function createMistake(
  userId: string,
  input: MistakeCreateInput,
): Promise<CreateMistakeResult> {
  const db = getDb();
  const r = schema.mistakeRecords;

  return db.transaction(async (tx): Promise<CreateMistakeResult> => {
    const [problem] = await tx
      .select({ id: schema.problems.id })
      .from(schema.problems)
      .where(and(eq(schema.problems.id, input.problemId), eq(schema.problems.userId, userId)))
      .limit(1);
    if (!problem) return { ok: false, error: "problem_not_found" };

    const source = await resolveSource(tx, userId, input);
    if (!source) return { ok: false, error: "source_not_found" };

    const [replay] = await tx
      .select()
      .from(r)
      .where(and(eq(r.userId, userId), eq(r.requestId, input.requestId)))
      .limit(1);
    if (replay) {
      const sameRequest =
        replay.problemId === input.problemId &&
        replay.sourceType === input.sourceType &&
        replay.primaryCategory === input.primaryCategory &&
        replay.submissionId === source.submissionId &&
        replay.quizSessionId === source.quizSessionId &&
        replay.quizItemId === source.quizItemId &&
        replay.reviewEventId === source.reviewEventId;
      if (!sameRequest) return { ok: false, error: "mistake_request_conflict" };
      return { ok: true, mistake: toMistakeDto(replay), idempotentReplay: true, deduplicated: false };
    }

    // Writers are serialized (BEGIN IMMEDIATE), so this check cannot race; the
    // partial unique indexes remain the backstop.
    const sourceCondition = sameSourceCondition(source);
    if (sourceCondition) {
      const [existing] = await tx
        .select()
        .from(r)
        .where(
          and(
            eq(r.userId, userId),
            sourceCondition,
            eq(r.primaryCategory, input.primaryCategory),
            ne(r.status, "dismissed"),
          ),
        )
        .limit(1);
      if (existing) {
        return { ok: true, mistake: toMistakeDto(existing), idempotentReplay: false, deduplicated: true };
      }
    }

    const now = new Date();
    const [created] = await tx
      .insert(r)
      .values({
        id: nanoid(12),
        userId,
        problemId: input.problemId,
        primaryCategory: input.primaryCategory,
        secondaryTags: input.secondaryTags,
        summary: optionalText(input.summary),
        nextStep: optionalText(input.nextStep),
        sourceType: input.sourceType,
        ...source,
        status: "confirmed",
        origin: "user",
        requestId: input.requestId,
        confirmedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return { ok: true, mistake: toMistakeDto(created!), idempotentReplay: false, deduplicated: false };
  });
}

type MistakesCursor = { createdAt: string; id: string };

function decodeCursor(value: string): { createdAt: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as MistakesCursor;
    const createdAt = new Date(parsed.createdAt);
    if (typeof parsed.id === "string" && parsed.id && !Number.isNaN(createdAt.getTime())) {
      return { createdAt, id: parsed.id };
    }
  } catch {
    // fall through
  }
  throw new InvalidMistakesCursorError();
}

function encodeCursor(row: MistakeRecord) {
  return Buffer.from(
    JSON.stringify({ createdAt: row.createdAt.toISOString(), id: row.id } satisfies MistakesCursor),
  ).toString("base64url");
}

/** Newest first, keyset-paginated on (createdAt, id). */
export async function listMistakes(
  userId: string,
  query: MistakeListQuery,
): Promise<MistakeListPayloadDto> {
  const r = schema.mistakeRecords;
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  const rows = await getDb()
    .select()
    .from(r)
    .where(
      and(
        eq(r.userId, userId),
        eq(r.status, query.status),
        query.problemId ? eq(r.problemId, query.problemId) : undefined,
        query.category ? eq(r.primaryCategory, query.category) : undefined,
        cursor
          ? or(
              lt(r.createdAt, cursor.createdAt),
              and(eq(r.createdAt, cursor.createdAt), lt(r.id, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(r.createdAt), desc(r.id))
    .limit(query.limit + 1);

  const page = rows.slice(0, query.limit);
  return {
    mistakes: page.map(toMistakeDto),
    nextCursor: rows.length > query.limit ? encodeCursor(page[page.length - 1]!) : null,
  };
}

export async function updateMistake(
  userId: string,
  id: string,
  patch: MistakePatchInput,
): Promise<UpdateMistakeResult> {
  const db = getDb();
  const r = schema.mistakeRecords;

  return db.transaction(async (tx): Promise<UpdateMistakeResult> => {
    const [row] = await tx
      .select()
      .from(r)
      .where(and(eq(r.id, id), eq(r.userId, userId)))
      .limit(1);
    if (!row) return { ok: false, error: "mistake_not_found" };

    // Only AI candidates change status; a user's own record is edited or deleted.
    if (patch.status !== undefined && patch.status !== row.status && row.status !== "candidate") {
      return { ok: false, error: "invalid_status_transition" };
    }

    const nextStatus = patch.status ?? row.status;
    const nextCategory = patch.primaryCategory ?? row.primaryCategory;
    const sourceCondition = sameSourceCondition(row);
    if (sourceCondition && nextStatus !== "dismissed") {
      const [clash] = await tx
        .select({ id: r.id })
        .from(r)
        .where(
          and(
            eq(r.userId, userId),
            sourceCondition,
            eq(r.primaryCategory, nextCategory),
            ne(r.status, "dismissed"),
            ne(r.id, row.id),
          ),
        )
        .limit(1);
      if (clash) return { ok: false, error: "duplicate_mistake" };
    }

    const now = new Date();
    const [updated] = await tx
      .update(r)
      .set({
        primaryCategory: nextCategory,
        ...(patch.secondaryTags !== undefined ? { secondaryTags: patch.secondaryTags } : {}),
        ...(patch.summary !== undefined ? { summary: optionalText(patch.summary) } : {}),
        ...(patch.nextStep !== undefined ? { nextStep: optionalText(patch.nextStep) } : {}),
        ...(patch.resolved !== undefined
          ? { resolvedAt: patch.resolved ? (row.resolvedAt ?? now) : null }
          : {}),
        ...(nextStatus !== row.status
          ? {
              status: nextStatus,
              ...(nextStatus === "confirmed" ? { confirmedAt: now } : { dismissedAt: now }),
            }
          : {}),
        updatedAt: now,
      })
      .where(and(eq(r.id, row.id), eq(r.userId, userId)))
      .returning();
    return { ok: true, mistake: toMistakeDto(updated!) };
  });
}

export async function deleteMistake(userId: string, id: string): Promise<boolean> {
  const r = schema.mistakeRecords;
  const deleted = await getDb()
    .delete(r)
    .where(and(eq(r.id, id), eq(r.userId, userId)))
    .returning({ id: r.id });
  return deleted.length > 0;
}

/** Confirmed records of one problem, newest first, for the problem page. */
export async function listProblemMistakes(userId: string, problemId: string) {
  const r = schema.mistakeRecords;
  const rows = await getDb()
    .select()
    .from(r)
    .where(and(eq(r.userId, userId), eq(r.problemId, problemId), eq(r.status, "confirmed")))
    .orderBy(desc(r.createdAt), desc(r.id))
    .limit(50);
  return rows.map(toMistakeDto);
}

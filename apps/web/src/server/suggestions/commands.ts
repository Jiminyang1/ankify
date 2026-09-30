import type {
  PracticeSessionErrorCode,
  PracticeSessionStartResponseDto,
  SuggestionActionInput,
  SuggestionAllocateInput,
  SuggestionAllocateResponseDto,
  SuggestionDto,
  SuggestionListDto,
} from "@ankify/contracts";
import { getDb, schema, type Suggestion } from "@ankify/db";
import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { afterSessionStart, startSessionInTransaction, type StartResult } from "../practice-sessions/commands";
import { findReplay, type DbTransaction } from "../practice-sessions/store";
import { findLeetcodeProblem } from "../problem-upsert";
import { getReviewSettings } from "../settings";
import { formatDateKeyInTimeZone } from "../time-zone";
import { recordAttempts } from "./history";
import { loadPlanningContext, planNext, toSuggestionDtos, type PlanningContext } from "./planning";

/** Suggestions per local day, replacements included. */
export const MAX_SUGGESTIONS_PER_DAY = 20;

export type SuggestionError =
  | "suggestion_not_found"
  | "suggestion_already_handled"
  | "suggestion_limit_reached"
  | "request_conflict"
  | PracticeSessionErrorCode;

export type SuggestionFailure = { ok: false; error: SuggestionError; message?: string; suggestion?: SuggestionDto };

export type SuggestionActionResponse = {
  suggestion: SuggestionDto;
  /** A skipped or attempted suggestion's replacement, when one was found. */
  replacement: SuggestionDto | null;
  /** The started (or resumed) practice session. */
  session: PracticeSessionStartResponseDto | null;
  idempotentReplay: boolean;
};

const s = schema.suggestions;

async function dtoOf(tx: DbTransaction, userId: string, row: Suggestion) {
  return (await toSuggestionDtos(tx, userId, [row]))[0]!;
}

async function todaysRows(tx: DbTransaction, userId: string, dateKey: string) {
  return tx.select().from(s).where(and(eq(s.userId, userId), eq(s.dateKey, dateKey))).orderBy(asc(s.ordinal));
}

/** Plans and stores one suggestion; null when nothing is eligible. */
async function allocate(
  tx: DbTransaction,
  userId: string,
  context: PlanningContext,
  slot: { ordinal: number; kind: Suggestion["kind"]; requestId: string; replacesId: string | null },
  now: Date,
) {
  const { plan, verifiedAt, novelty } = await planNext(tx, userId, context, slot.ordinal, now);
  if (plan.kind === "none") return null;
  const [row] = await tx
    .insert(s)
    .values({
      id: nanoid(12),
      userId,
      dateKey: context.dateKey,
      ordinal: slot.ordinal,
      kind: slot.kind,
      replacesId: slot.replacesId,
      slug: plan.target.slug,
      title: plan.target.title,
      difficulty: plan.target.difficulty,
      topicTags: plan.target.topicTags,
      category: plan.category,
      lane: plan.lane,
      reasons: plan.reasons,
      plannerVersion: plan.plannerVersion,
      verifiedAt: verifiedAt!,
      novelty,
      requestId: slot.requestId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row!;
}

/**
 * The day's suggestion (allocated once per local day; later requests return
 * it) or one more. Target and explanation are frozen when stored. Nothing is
 * stored when no problem is eligible.
 */
export async function allocateSuggestion(
  userId: string,
  input: SuggestionAllocateInput,
  now = new Date(),
): Promise<{ ok: true; response: SuggestionAllocateResponseDto } | SuggestionFailure> {
  const context = await loadPlanningContext(userId, now);
  return getDb().transaction(async (tx) => {
    const [replay] = await tx.select().from(s).where(and(eq(s.userId, userId), eq(s.requestId, input.requestId))).limit(1);
    if (replay) {
      if (replay.kind !== input.kind) return { ok: false, error: "request_conflict" };
      return { ok: true, response: { suggestion: await dtoOf(tx, userId, replay), idempotentReplay: true } };
    }
    const today = await todaysRows(tx, userId, context.dateKey);
    const daily = today.find((row) => row.ordinal === 0);
    if (input.kind === "daily" && daily) {
      return { ok: true, response: { suggestion: await dtoOf(tx, userId, daily), idempotentReplay: true } };
    }
    if (today.length >= MAX_SUGGESTIONS_PER_DAY) return { ok: false, error: "suggestion_limit_reached" };
    const ordinal = input.kind === "daily" ? 0 : Math.max(1, (today.at(-1)?.ordinal ?? 0) + 1);
    const row = await allocate(tx, userId, context, { ordinal, kind: input.kind, requestId: input.requestId, replacesId: null }, now);
    if (!row) return { ok: true, response: { suggestion: null, reason: "no_candidates" } };
    return { ok: true, response: { suggestion: await dtoOf(tx, userId, row), idempotentReplay: false } };
  });
}

const ACTION_STATUS = { skip: "skipped", already_attempted: "already_attempted", start: "started" } as const;

/**
 * Skip, Already Attempted, or Start, once per suggestion (idempotent per
 * request id). Skip and Already Attempted store today's replacement in the
 * same transaction; Already Attempted also excludes the problem for good.
 * Start runs the practice-session start in the same transaction: a problem
 * new to Ankify starts initial learning, like any other first practice.
 */
export async function actOnSuggestion(
  userId: string,
  suggestionId: string,
  input: SuggestionActionInput,
  now = new Date(),
): Promise<{ ok: true; response: SuggestionActionResponse } | SuggestionFailure> {
  const context = input.action === "start" ? null : await loadPlanningContext(userId, now);
  let started: StartResult | null = null;
  const result = await getDb().transaction(async (tx): Promise<{ ok: true; response: SuggestionActionResponse } | SuggestionFailure> => {
    const [row] = await tx.select().from(s).where(and(eq(s.id, suggestionId), eq(s.userId, userId))).limit(1);
    if (!row) return { ok: false, error: "suggestion_not_found" };
    const replay = row.actionRequestId === input.requestId;
    if (replay && row.status !== ACTION_STATUS[input.action]) return { ok: false, error: "request_conflict" };
    if (!replay && row.status !== "pending") {
      return { ok: false, error: "suggestion_already_handled", suggestion: await dtoOf(tx, userId, row) };
    }

    if (input.action === "start") {
      if (replay) {
        const command = await findReplay(tx, userId, input.requestId);
        const session = command ? { ...(command.response as PracticeSessionStartResponseDto), idempotentReplay: true } : null;
        return { ok: true, response: { suggestion: await dtoOf(tx, userId, row), replacement: null, session, idempotentReplay: true } };
      }
      // A problem already in the deck is started by id, so the suggestion's
      // stored metadata never overwrites its own (similar questions, topics).
      const lookup = await findLeetcodeProblem(tx, userId, { leetcodeSlug: row.slug });
      if (lookup.kind === "conflict") return { ok: false, error: "duplicate_problem_conflict" };
      started = await startSessionInTransaction(
        tx,
        userId,
        {
          requestId: input.requestId,
          ownerToken: input.ownerToken,
          mode: "practice",
          target:
            lookup.kind === "found"
              ? { kind: "problem", problemId: lookup.problem.id }
              : {
                  kind: "leetcode",
                  problem: {
                    leetcodeSlug: row.slug,
                    title: row.title,
                    difficulty: row.difficulty,
                    url: `https://leetcode.com/problems/${row.slug}/`,
                    topicTags: row.topicTags,
                    similarSlugs: [],
                  },
                },
          supersedePendingRating: false,
        },
        now,
      );
      if (!started.ok) return { ok: false, error: started.error, ...(started.message ? { message: started.message } : {}) };
      const [updated] = await tx
        .update(s)
        .set({ status: "started", practiceSessionId: started.response.session.id, actionRequestId: input.requestId, actedAt: now, updatedAt: now })
        .where(and(eq(s.id, row.id), eq(s.userId, userId), eq(s.status, "pending")))
        .returning();
      return {
        ok: true,
        response: { suggestion: await dtoOf(tx, userId, updated!), replacement: null, session: started.response, idempotentReplay: false },
      };
    }

    let current = row;
    if (!replay) {
      [current] = (await tx
        .update(s)
        .set({ status: ACTION_STATUS[input.action], actionRequestId: input.requestId, actedAt: now, updatedAt: now })
        .where(and(eq(s.id, row.id), eq(s.userId, userId), eq(s.status, "pending")))
        .returning()) as [Suggestion];
      if (input.action === "already_attempted") {
        await recordAttempts(tx, userId, "user_marked", null, [{ slug: row.slug, status: "attempted" }], now);
      }
    }
    const replacementRequestId = `replacement:${row.id}`;
    let [replacement] = await tx.select().from(s).where(and(eq(s.userId, userId), eq(s.requestId, replacementRequestId))).limit(1);
    if (!replacement && !replay) {
      const today = await todaysRows(tx, userId, context!.dateKey);
      if (today.length < MAX_SUGGESTIONS_PER_DAY) {
        const ordinal = Math.max(1, (today.at(-1)?.ordinal ?? 0) + 1);
        replacement =
          (await allocate(tx, userId, context!, { ordinal, kind: "replacement", requestId: replacementRequestId, replacesId: row.id }, now)) ?? undefined;
      }
    }
    return {
      ok: true,
      response: {
        suggestion: await dtoOf(tx, userId, current),
        replacement: replacement ? await dtoOf(tx, userId, replacement) : null,
        session: null,
        idempotentReplay: replay,
      },
    };
  });
  if (started) await afterSessionStart(userId, started);
  return result;
}

/** Today's suggestions in the user's time zone, oldest first. */
export async function listSuggestions(userId: string, now = new Date()): Promise<SuggestionListDto> {
  const review = await getReviewSettings(userId);
  const dateKey = formatDateKeyInTimeZone(now, review.timeZone);
  const db = getDb();
  const rows = await db.select().from(s).where(and(eq(s.userId, userId), eq(s.dateKey, dateKey))).orderBy(asc(s.ordinal));
  return { dateKey, suggestions: await toSuggestionDtos(db, userId, rows) };
}

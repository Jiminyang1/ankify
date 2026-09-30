import type {
  PracticeSessionCurrentDto,
  PracticeSessionDetailDto,
  PracticeSessionListDto,
  PracticeSessionListQuery,
} from "@ankify/contracts";
import { effectiveRatingDisposition, isSessionStale, summarizeSession } from "@ankify/core";
import { getDb, schema, type PracticeSession } from "@ankify/db";
import { and, asc, desc, eq, inArray, lt, or } from "drizzle-orm";
import { loadSessionEvidence, toObservationDto, toPracticeSessionDto, toProblemStatusDto } from "./dto";

export class InvalidSessionsCursorError extends Error {}

const ps = schema.practiceSessions;

/**
 * What the extension shows on a problem page: the problem's Ankify status,
 * its open session (unless stale), and a completed review awaiting a rating.
 */
export async function getCurrentPracticeSession(
  userId: string,
  target: { problemId?: string; slug?: string },
  ownerToken: string | null,
  now = new Date(),
): Promise<PracticeSessionCurrentDto> {
  const db = getDb();
  const p = schema.problems;
  const [problem] = await db
    .select()
    .from(p)
    .where(and(eq(p.userId, userId), target.problemId ? eq(p.id, target.problemId) : eq(p.leetcodeSlug, target.slug!)))
    .limit(1);
  if (!problem) return { problem: null, session: null, pendingRating: null };

  const [open, ratable] = await Promise.all([
    db.select().from(ps).where(and(eq(ps.userId, userId), eq(ps.problemId, problem.id), eq(ps.isOpen, true))).limit(1),
    db
      .select()
      .from(ps)
      .where(and(eq(ps.userId, userId), eq(ps.problemId, problem.id), inArray(ps.ratingDisposition, ["pending", "deferred"])))
      .orderBy(desc(ps.completedAt))
      .limit(5),
  ]);
  const session = open[0] && !isSessionStale(open[0], now) ? open[0] : null;
  const pending =
    ratable.find((row) => {
      const disposition = effectiveRatingDisposition(row, problem.scheduleRevision, now);
      return disposition === "pending" || disposition === "deferred";
    }) ?? null;
  const evidence = await loadSessionEvidence(db, userId, [session?.id, pending?.id].filter((id): id is string => Boolean(id)));
  const toDto = (row: PracticeSession) =>
    toPracticeSessionDto(row, { problemScheduleRevision: problem.scheduleRevision, evidence: evidence.get(row.id), ownerToken, now });
  return {
    problem: toProblemStatusDto(problem, now),
    session: session ? toDto(session) : null,
    pendingRating: pending ? toDto(pending) : null,
  };
}

export async function getPracticeSessionDetail(
  userId: string,
  sessionId: string,
  ownerToken: string | null,
  now = new Date(),
): Promise<PracticeSessionDetailDto | null> {
  const db = getDb();
  const [session] = await db.select().from(ps).where(and(eq(ps.id, sessionId), eq(ps.userId, userId))).limit(1);
  if (!session) return null;
  const o = schema.practiceSessionSubmissions;
  const [[problem], observations, evidence] = await Promise.all([
    db
      .select()
      .from(schema.problems)
      .where(and(eq(schema.problems.id, session.problemId), eq(schema.problems.userId, userId)))
      .limit(1),
    db
      .select()
      .from(o)
      .where(and(eq(o.userId, userId), eq(o.sessionId, session.id)))
      .orderBy(asc(o.firstObservedAt), asc(o.id)),
    loadSessionEvidence(db, userId, [session.id]),
  ]);
  return {
    session: toPracticeSessionDto(session, {
      problemScheduleRevision: problem!.scheduleRevision,
      evidence: evidence.get(session.id),
      ownerToken,
      now,
    }),
    problem: toProblemStatusDto(problem!, now),
    observations: observations.map(toObservationDto),
    summary: (() => {
      const summary = summarizeSession(
        observations
          .filter((row) => row.association === "automatic" || row.association === "confirmed")
          .map((row) => ({ verdict: row.verdict, at: row.submittedAt ?? row.firstObservedAt })),
      );
      return { ...summary, firstAcceptedAt: summary.firstAcceptedAt?.toISOString() ?? null };
    })(),
  };
}

type SessionsCursor = { startedAt: string; id: string };

function decodeCursor(value: string) {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as SessionsCursor;
    const startedAt = new Date(parsed.startedAt);
    if (typeof parsed.id === "string" && parsed.id && !Number.isNaN(startedAt.getTime())) {
      return { startedAt, id: parsed.id };
    }
  } catch {
    // fall through
  }
  throw new InvalidSessionsCursorError();
}

function encodeCursor(row: PracticeSession) {
  return Buffer.from(JSON.stringify({ startedAt: row.startedAt.toISOString(), id: row.id } satisfies SessionsCursor)).toString(
    "base64url",
  );
}

/** Session history, newest first, keyset-paginated on (startedAt, id). */
export async function listPracticeSessions(
  userId: string,
  query: PracticeSessionListQuery,
  now = new Date(),
): Promise<PracticeSessionListDto> {
  const db = getDb();
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  const rows = await db
    .select()
    .from(ps)
    .where(
      and(
        eq(ps.userId, userId),
        query.problemId ? eq(ps.problemId, query.problemId) : undefined,
        cursor ? or(lt(ps.startedAt, cursor.startedAt), and(eq(ps.startedAt, cursor.startedAt), lt(ps.id, cursor.id))) : undefined,
      ),
    )
    .orderBy(desc(ps.startedAt), desc(ps.id))
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  const problemIds = [...new Set(page.map((row) => row.problemId))];
  const [revisions, evidence] = await Promise.all([
    problemIds.length
      ? db
          .select({ id: schema.problems.id, scheduleRevision: schema.problems.scheduleRevision })
          .from(schema.problems)
          .where(and(eq(schema.problems.userId, userId), inArray(schema.problems.id, problemIds)))
      : Promise.resolve([]),
    loadSessionEvidence(db, userId, page.map((row) => row.id)),
  ]);
  const revisionByProblem = new Map(revisions.map((row) => [row.id, row.scheduleRevision]));
  return {
    sessions: page.map((row) =>
      toPracticeSessionDto(row, {
        problemScheduleRevision: revisionByProblem.get(row.problemId) ?? 0,
        evidence: evidence.get(row.id),
        now,
      }),
    ),
    nextCursor: rows.length > query.limit ? encodeCursor(page[page.length - 1]!) : null,
  };
}

import type { PracticeSessionDto, PracticeSessionErrorCode } from "@ankify/contracts";
import {
  getDb,
  schema,
  type NewPracticeSession,
  type PracticeSession,
  type PracticeSessionCommand,
  type Problem,
} from "@ankify/db";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { loadSessionEvidence, toPracticeSessionDto } from "./dto";

/** Transaction helpers shared by session commands and scheduling. */
export type DbTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export type SessionFailure = {
  ok: false;
  error: PracticeSessionErrorCode;
  message?: string;
  session?: PracticeSessionDto;
};

export type SessionPatch = Partial<Omit<NewPracticeSession, "id" | "userId" | "problemId" | "requestId">>;

const ps = schema.practiceSessions;

export function fail(error: PracticeSessionErrorCode, session?: PracticeSessionDto, message?: string): SessionFailure {
  return { ok: false, error, ...(session ? { session } : {}), ...(message ? { message } : {}) };
}

export async function loadSession(tx: DbTransaction, userId: string, sessionId: string) {
  const [row] = await tx.select().from(ps).where(and(eq(ps.id, sessionId), eq(ps.userId, userId))).limit(1);
  return row ?? null;
}

export async function loadProblem(tx: DbTransaction, userId: string, problemId: string) {
  const [row] = await tx
    .select()
    .from(schema.problems)
    .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function findReplay(tx: DbTransaction, userId: string, requestId: string) {
  const c = schema.practiceSessionCommands;
  const [row] = await tx
    .select()
    .from(c)
    .where(and(eq(c.userId, userId), eq(c.requestId, requestId)))
    .limit(1);
  return row ?? null;
}

export async function recordCommand(
  tx: DbTransaction,
  row: Pick<PracticeSessionCommand, "userId" | "sessionId" | "requestId" | "command" | "payloadDigest" | "response">,
  now: Date,
) {
  await tx.insert(schema.practiceSessionCommands).values({ id: nanoid(12), ...row, createdAt: now });
}

export async function updateSession(
  tx: DbTransaction,
  userId: string,
  session: PracticeSession,
  patch: SessionPatch,
  now: Date,
): Promise<PracticeSession> {
  const [row] = await tx
    .update(ps)
    .set({ ...patch, revision: session.revision + 1, updatedAt: now })
    .where(and(eq(ps.id, session.id), eq(ps.userId, userId)))
    .returning();
  return row!;
}

export async function sessionDto(
  tx: DbTransaction,
  userId: string,
  session: PracticeSession,
  problem: Pick<Problem, "scheduleRevision">,
  now: Date,
  ownerToken?: string | null,
) {
  const evidence = (await loadSessionEvidence(tx, userId, [session.id])).get(session.id);
  return toPracticeSessionDto(session, { problemScheduleRevision: problem.scheduleRevision, evidence, ownerToken, now });
}

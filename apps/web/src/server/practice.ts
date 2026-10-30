import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { LanguageModel } from "ai";
import {
  EMPTY_TALK_STATE,
  GRADE_BY_HELP,
  WEAKNESS_RESOLVE_STREAK,
  advanceTalk,
  parseSolutions,
  scoreTalk,
  selectPracticeTargets,
  withTalkReferences,
  type TalkGrade,
  type TalkHelp,
  type TalkJudgement,
  type SolutionApproach,
  type TalkSettledBy,
} from "@ankify/core";
import type { AgentPageContext, PracticeSessionDto } from "@ankify/contracts";
import {
  getDb,
  schema,
  type PracticeGrade,
  type PracticeSession,
  type PracticeTarget,
  type TalkLogEntry,
  type TalkTargetRecord,
  type WeaknessSnapshot,
} from "@ankify/db";
import { judgeDispute, judgeReply, judgeStatement } from "@/server/practice-judge";
import { askInstruction, fallbackInstruction, moveInstruction, type TalkNext } from "@/server/practice-instructions";
import { ensureSolutionsDoc, plainText } from "@/server/practice-solutions";
import type { AiRuntimeSettings } from "@/server/settings";

/**
 * Practice sessions (docs/coach-practice.md, version 3): a talk-through. The
 * approach first, then up to two of the problem's weak spots, each reply read
 * by the judge (practice-judge.ts) against the target's reference; code
 * decides the next move and the grade (packages/core/src/practice-talk.ts),
 * and the Coach only phrases it. Stage-2 sessions (cards, then generated
 * questions) are legacy: nothing starts one, and an active one is abandoned
 * the next time it's loaded.
 */

export type PracticeError =
  | "problem_not_found"
  | "practice_not_found"
  | "practice_not_active"
  | "already_answered"
  | "target_not_found"
  | "judged_target"
  | "not_disputable";

export type PracticeResult = { ok: true; session: PracticeSessionDto } | { ok: false; error: PracticeError; message?: string };

export const PRACTICE_ERROR_STATUS: Record<PracticeError, number> = {
  problem_not_found: 404,
  practice_not_found: 404,
  practice_not_active: 409,
  already_answered: 409,
  target_not_found: 404,
  judged_target: 409,
  not_disputable: 409,
};

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export function toPracticeDto(session: PracticeSession): PracticeSessionDto {
  return {
    id: session.id,
    problemId: session.problemId,
    status: session.status,
    mode: session.mode,
    endedEarly: session.resultsJson.endedEarly === true,
    targets: (session.targetsJson ?? []).map((target) => talkTargetDto(session, target)),
    recall: [],
    check: { status: "skipped", message: null, items: [] },
    score: session.score,
    suggestedRating: (session.suggestedRating as 1 | 2 | 3 | 4 | null) ?? null,
    createdAt: session.createdAt.toISOString(),
    completedAt: session.completedAt?.toISOString() ?? null,
  };
}

/** A talk-through target for the client. The reference points stay hidden
 *  until the target is settled; then each shows whether it was covered. */
function talkTargetDto(session: PracticeSession, target: PracticeTarget): PracticeSessionDto["targets"][number] {
  const results = session.resultsJson;
  const grade = results.talk?.[target.id] ?? null;
  const record = results.talkState?.[target.id];
  const reference = target.reference;
  const judged = Boolean(reference) && !record?.fallback;
  const approach =
    reference?.approaches.find((candidate) => candidate.id === record?.approachId) ??
    (reference?.mode === "avoid_mistake" ? reference.approaches[0] : undefined);
  const covered = new Set(record?.covered ?? []);
  return {
    id: target.id,
    kind: target.kind,
    category: target.category ?? null,
    label: target.label,
    grade,
    nudges: record?.nudges ?? results.followUps?.[target.id] ?? 0,
    judged,
    progress: !grade && judged && approach ? { covered: covered.size, total: approach.points.length } : null,
    settledBy: record?.settledBy ?? null,
    help: record?.help ?? 0,
    review:
      grade && judged
        ? {
            approach: approach && reference?.mode === "key_points" ? approach.name : null,
            points: (approach?.points ?? []).map((point) => ({ text: point.text, covered: covered.has(point.id) })),
          }
        : null,
    canDispute: Boolean(grade && judged && record && canDispute(grade.grade, record)),
  };
}

function canDispute(grade: TalkGrade, record: TalkTargetRecord) {
  return (
    grade !== "correct" &&
    !record.disputed &&
    record.settledBy !== "gave_up" &&
    record.log.some((entry) => entry.role === "learner")
  );
}

async function loadOwned(userId: string, sessionId: string) {
  const [session] = await getDb()
    .select()
    .from(schema.practiceSessions)
    .where(and(eq(schema.practiceSessions.id, sessionId), eq(schema.practiceSessions.userId, userId)))
    .limit(1);
  return session ? retireStageTwo(session) : null;
}

/** The active talk-through on a problem, or null. */
async function loadActive(userId: string, problemId: string) {
  const [session] = await getDb()
    .select()
    .from(schema.practiceSessions)
    .where(
      and(
        eq(schema.practiceSessions.userId, userId),
        eq(schema.practiceSessions.problemId, problemId),
        eq(schema.practiceSessions.status, "active"),
      ),
    )
    .limit(1);
  if (!session) return null;
  const current = await retireStageTwo(session);
  return current.status === "active" ? current : null;
}

/** A stage-2 session (cards, then generated questions) can't be continued any
 *  more, so an active one is abandoned, which also frees the problem for a
 *  talk-through. */
async function retireStageTwo(session: PracticeSession): Promise<PracticeSession> {
  if (session.mode === "talk" || session.status !== "active") return session;
  const now = new Date();
  const [abandoned] = await getDb()
    .update(schema.practiceSessions)
    .set({ status: "abandoned", completedAt: now, updatedAt: now })
    .where(and(eq(schema.practiceSessions.id, session.id), eq(schema.practiceSessions.status, "active")))
    .returning();
  return abandoned ?? { ...session, status: "abandoned" };
}

/** Starts a talk-through (docs/coach-practice.md, version 3), or returns the
 *  active one: the approach first, then this problem's weak spots, each
 *  judged against a reference. It starts at once: a problem without a
 *  Solutions doc gets one during the turn that asks the first question
 *  (prepareTalkReferences). */
export async function startPractice(
  userId: string,
  problemId: string,
  options: { agentRunId?: string } = {},
): Promise<PracticeResult> {
  const db = getDb();
  const [owned] = await db
    .select({ id: schema.problems.id })
    .from(schema.problems)
    .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, userId)))
    .limit(1);
  if (!owned) return { ok: false, error: "problem_not_found" };
  const existing = await loadActive(userId, problemId);
  if (existing) return { ok: true, session: toPracticeDto(existing) };
  const weaknesses = await db
    .select({
      id: schema.weaknesses.id,
      category: schema.weaknesses.category,
      detail: schema.weaknesses.detail,
      lastSeenAt: schema.weaknesses.lastSeenAt,
    })
    .from(schema.weaknesses)
    .where(
      and(
        eq(schema.weaknesses.userId, userId),
        eq(schema.weaknesses.problemId, problemId),
        eq(schema.weaknesses.status, "active"),
      ),
    );
  const approaches = await currentSolutions(userId, problemId);
  const targets = withTalkReferences(selectPracticeTargets({ problemWeaknesses: weaknesses }), approaches);
  const id = nanoid(16);
  const now = new Date();
  const inserted = await db
    .insert(schema.practiceSessions)
    .values({
      id,
      userId,
      problemId,
      agentRunId: options.agentRunId ?? null,
      mode: "talk",
      targetsJson: targets,
      recallJson: [],
      checkStatus: "skipped",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) {
    const raced = await loadActive(userId, problemId);
    return raced ? { ok: true, session: toPracticeDto(raced) } : { ok: false, error: "practice_not_found" };
  }
  return { ok: true, session: toPracticeDto(inserted[0]!) };
}

async function currentSolutions(userId: string, problemId: string) {
  const [row] = await getDb()
    .select({ solutionsMd: schema.problems.solutionsMd })
    .from(schema.problems)
    .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, userId)))
    .limit(1);
  return parseSolutions(row?.solutionsMd).approaches;
}

/** Attaches the problem's Solutions doc to an active session's approach
 *  question, if it lacks one. Returns the updated session, or null when there
 *  was nothing to attach. */
async function attachSolutions(sessionId: string, approaches: SolutionApproach[]) {
  if (approaches.length === 0) return null;
  return getDb().transaction(async (tx) => {
    const [fresh] = await tx
      .select()
      .from(schema.practiceSessions)
      .where(eq(schema.practiceSessions.id, sessionId))
      .limit(1);
    if (!fresh || fresh.status !== "active") return null;
    const targets = fresh.targetsJson ?? [];
    if (!targets.some((target) => target.kind === "core" && !target.reference)) return null;
    // Questions that already have a reference keep the one they started with.
    const withReferences = targets.map((target) =>
      target.reference ? target : withTalkReferences([target], approaches)[0]!,
    );
    const [updated] = await tx
      .update(schema.practiceSessions)
      .set({ targetsJson: withReferences, updatedAt: new Date() })
      .where(eq(schema.practiceSessions.id, sessionId))
      .returning();
    return updated ?? null;
  });
}

/**
 * The first practice on a problem writes its Solutions doc. It runs during the
 * turn that asks the first question, alongside the Coach, so the user reads and
 * types meanwhile and their first answer is judged against it. Never throws:
 * if the doc can't be written, that question falls back to the Coach grading
 * it (the tray says so).
 */
export async function prepareTalkReferences(args: {
  userId: string;
  problemId: string;
  model: LanguageModel;
  settings: AiRuntimeSettings;
  abortSignal?: AbortSignal;
}): Promise<PracticeSessionDto | null> {
  const session = await loadActive(args.userId, args.problemId);
  if (!session) return null;
  if (!(session.targetsJson ?? []).some((target) => target.kind === "core" && !target.reference)) return null;
  let approaches = await currentSolutions(args.userId, args.problemId);
  if (approaches.length === 0) {
    try {
      approaches = await ensureSolutionsDoc(args);
    } catch (error) {
      if (args.abortSignal?.aborted) return null;
      console.error("[practice] couldn't write the Solutions doc; the Coach grades the approach", error);
    }
  }
  const updated = await attachSolutions(session.id, approaches);
  return updated ? toPracticeDto(updated) : null;
}

export async function getPractice(userId: string, sessionId: string): Promise<PracticeResult> {
  const session = await loadOwned(userId, sessionId);
  if (!session) return { ok: false, error: "practice_not_found" };
  return { ok: true, session: toPracticeDto(session) };
}

/** The talk-through in progress on a problem, so the panel can resume it. */
export async function getCurrentPractice(userId: string, problemId: string): Promise<PracticeSessionDto | null> {
  const session = await loadActive(userId, problemId);
  return session ? toPracticeDto(session) : null;
}

/** Finishes a talk-through once every target has a grade. */
async function completeIfDone(tx: Tx, sessionId: string): Promise<PracticeSession> {
  const [session] = await tx
    .select()
    .from(schema.practiceSessions)
    .where(eq(schema.practiceSessions.id, sessionId))
    .limit(1);
  if (!session || session.status !== "active" || session.mode !== "talk") return session!;
  return completeTalkIfDone(tx, session);
}

/* ── Talk-through turns (version 3; version 2 sessions are Coach-graded) ── */

const TALK_LOG_MAX = 16;
const TALK_LINE_MAX = 2_000;

type TalkContext = NonNullable<AgentPageContext["practiceActive"]>;

const GRADE_RANK: Record<TalkGrade, number> = { missed: 0, partial: 1, correct: 2 };

function talkRecord(session: PracticeSession, targetId: string): TalkTargetRecord {
  return session.resultsJson.talkState?.[targetId] ?? { ...EMPTY_TALK_STATE, log: [] };
}

/** The target being asked about: the first one without a grade. */
function currentTarget(session: PracticeSession): PracticeTarget | null {
  const talk = session.resultsJson.talk ?? {};
  return (session.targetsJson ?? []).find((target) => !talk[target.id]) ?? null;
}

function appendLog(log: TalkLogEntry[], entry: TalkLogEntry): TalkLogEntry[] {
  const text = entry.text.trim();
  const clipped = text.length <= TALK_LINE_MAX ? text : `${text.slice(0, TALK_LINE_MAX)} ...`;
  return [...log, { ...entry, text: clipped }].slice(-TALK_LOG_MAX);
}

function settleReason(by: TalkSettledBy, help: TalkHelp): string {
  if (by === "gave_up") return "Skipped";
  if (by === "not_recalled") return "Not recalled; explained";
  if (by === "new_approach") return "A valid approach not in the Solutions doc";
  return ["Recalled on their own", "Recalled once the missing part was named", "Needed a hint"][help]!;
}

function talkContext(session: PracticeSession, instruction?: string): TalkContext {
  const talk = session.resultsJson.talk ?? {};
  return {
    practiceSessionId: session.id,
    targets: (session.targetsJson ?? []).map((target) => ({
      id: target.id,
      kind: target.kind,
      category: target.category ?? null,
      label: target.label.slice(0, 400),
      grade: talk[target.id]?.grade ?? null,
    })),
    ...(instruction ? { instruction } : {}),
  };
}

/** The active talk-through on a problem, as the Coach sees it. */
export async function getActiveTalkContext(userId: string, problemId: string): Promise<TalkContext | null> {
  const session = await loadActive(userId, problemId);
  if (!session) return null;
  return talkContext(session);
}

export type TalkTurn = { context: TalkContext; session: PracticeSessionDto };

/** The Coach's first question, for the turn that opens a session. */
export async function startTalkTurn(userId: string, problemId: string): Promise<TalkTurn | null> {
  const session = await loadActive(userId, problemId);
  if (!session) return null;
  const target = currentTarget(session);
  if (!target) return null;
  return { context: talkContext(session, askInstruction(target)), session: toPracticeDto(session) };
}

export function firstTalkInstruction(session: PracticeSessionDto): string | null {
  const target = session.targets.find((candidate) => !candidate.grade);
  return target ? askInstruction({ id: target.id, kind: target.kind, label: target.label, category: target.category ?? undefined }) : null;
}

async function loadJudgeProblem(userId: string, problemId: string) {
  const [problem] = await getDb()
    .select({
      title: schema.problems.title,
      difficulty: schema.problems.difficulty,
      descriptionMd: schema.problems.descriptionMd,
    })
    .from(schema.problems)
    .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, userId)))
    .limit(1);
  return {
    title: problem?.title ?? "",
    difficulty: problem?.difficulty ?? "",
    statement: judgeStatement(plainText(problem?.descriptionMd)),
  };
}

function judgeQuestion(target: PracticeTarget): string {
  return target.kind === "weakness"
    ? "Whether the learner now gets this right on this problem (the reference is a mistake they made before)."
    : "Which technique the learner would use and what in the problem statement points to it, then how they would solve the problem and what it costs in time and space.";
}

/** Writes one target's record, merged into the latest results. */
async function saveTalkRecord(sessionId: string, targetId: string, record: TalkTargetRecord) {
  return getDb().transaction(async (tx) => {
    const [fresh] = await tx
      .select()
      .from(schema.practiceSessions)
      .where(eq(schema.practiceSessions.id, sessionId))
      .limit(1);
    if (!fresh || fresh.status !== "active") return null;
    const resultsJson = {
      ...fresh.resultsJson,
      talkState: { ...fresh.resultsJson.talkState, [targetId]: record },
    };
    await tx
      .update(schema.practiceSessions)
      .set({ resultsJson, updatedAt: new Date() })
      .where(eq(schema.practiceSessions.id, sessionId));
    return { ...fresh, resultsJson };
  });
}

/**
 * One reply while a talk-through is active: the judge reads it against the
 * current question's reference, code decides the next move and any grade, and
 * the Coach gets the move as its instruction. If the judge fails (or there's
 * no reference), the Coach grades that question itself.
 */
export async function judgeTalkTurn(args: {
  userId: string;
  problemId: string;
  message: string;
  model: LanguageModel;
  settings: AiRuntimeSettings;
  abortSignal?: AbortSignal;
}): Promise<TalkTurn | null> {
  let session = await loadActive(args.userId, args.problemId);
  if (!session) return null;
  let target = currentTarget(session);
  if (!target) return null;
  const record = talkRecord(session, target.id);
  // A Solutions doc written since the session started (by its first turn, or
  // the user) still judges a question nobody has answered yet.
  if (target.kind === "core" && !target.reference && !record.fallback) {
    const attached = await attachSolutions(session.id, await currentSolutions(args.userId, args.problemId));
    if (attached) {
      session = attached;
      target = currentTarget(attached) ?? target;
    }
  }
  const log = appendLog(record.log, { role: "learner", text: args.message, help: record.help });
  const reference = target.reference;

  let judgement: TalkJudgement | null = null;
  if (reference && !record.fallback) {
    try {
      judgement = await judgeReply(args, {
        problem: await loadJudgeProblem(args.userId, args.problemId),
        question: judgeQuestion(target),
        reference,
        log,
      });
    } catch (error) {
      if (args.abortSignal?.aborted) throw error;
      console.error("[practice] the judge failed; the Coach grades this question", error);
    }
  }
  if (!reference || !judgement) {
    const updated = await saveTalkRecord(session.id, target.id, { ...record, log, fallback: true });
    return updated ? { context: talkContext(updated, fallbackInstruction(target)), session: toPracticeDto(updated) } : null;
  }

  const step = advanceTalk(record, judgement, reference);
  const settled = step.move.kind === "settle" ? step.move : null;
  const nextRecord: TalkTargetRecord = { ...step.state, log, ...(settled ? { settledBy: settled.by } : {}) };
  const updated = await getDb().transaction(async (tx) => {
    const [fresh] = await tx
      .select()
      .from(schema.practiceSessions)
      .where(eq(schema.practiceSessions.id, session.id))
      .limit(1);
    // Ended, or graded by another turn meanwhile: this reply changes nothing.
    if (!fresh || fresh.status !== "active" || fresh.resultsJson.talk?.[target.id]) return null;
    const resultsJson = {
      ...fresh.resultsJson,
      talkState: { ...fresh.resultsJson.talkState, [target.id]: nextRecord },
      ...(settled
        ? {
            talk: {
              ...fresh.resultsJson.talk,
              [target.id]: { grade: settled.grade, reason: settleReason(settled.by, nextRecord.help) },
            },
          }
        : {}),
    };
    await tx
      .update(schema.practiceSessions)
      .set({ resultsJson, updatedAt: new Date() })
      .where(eq(schema.practiceSessions.id, session.id));
    return settled ? completeIfDone(tx, session.id) : { ...fresh, resultsJson };
  });
  if (!updated) return null;

  let next: TalkNext = { kind: "none" };
  if (settled && updated.status === "completed") {
    const grades = Object.values(updated.resultsJson.talk ?? {});
    next = {
      kind: "completed",
      correct: grades.filter((grade) => grade.grade === "correct").length,
      total: grades.length,
      suggestedRating: (updated.suggestedRating ?? 3) as 1 | 2 | 3 | 4,
    };
  } else if (settled) {
    const following = currentTarget(updated);
    if (following) next = { kind: "target", target: following };
  }
  const instruction = moveInstruction({ move: step.move, reference, state: step.state, next });
  return { context: talkContext(updated, instruction), session: toPracticeDto(updated) };
}

/** Keeps the Coach's reply in the current question's log, so the judge can
 *  read what was asked. A reply that settled one question and asked the next
 *  belongs to the next. */
export async function recordTutorLine(userId: string, problemId: string, text: string) {
  if (!text.trim()) return;
  const session = await loadActive(userId, problemId);
  if (!session) return;
  const target = currentTarget(session);
  if (!target) return;
  const record = talkRecord(session, target.id);
  await saveTalkRecord(session.id, target.id, { ...record, log: appendLog(record.log, { role: "tutor", text }) });
}

async function loadActiveTalk(tx: Tx, userId: string, problemId: string) {
  const [session] = await tx
    .select()
    .from(schema.practiceSessions)
    .where(
      and(
        eq(schema.practiceSessions.userId, userId),
        eq(schema.practiceSessions.problemId, problemId),
        eq(schema.practiceSessions.status, "active"),
      ),
    )
    .limit(1);
  return session && session.mode === "talk" ? session : null;
}

/** The Coach's grade for a question the judge couldn't read (grade_answer).
 *  Help already given still caps it. The last grade completes the session. */
export async function gradeTalkTarget(
  userId: string,
  problemId: string,
  targetId: string,
  grade: PracticeGrade,
): Promise<PracticeResult> {
  return getDb().transaction(async (tx) => {
    const session = await loadActiveTalk(tx, userId, problemId);
    if (!session) return { ok: false, error: "practice_not_active" } as const;
    const target = (session.targetsJson ?? []).find((candidate) => candidate.id === targetId);
    if (!target) return { ok: false, error: "target_not_found" } as const;
    const talk = session.resultsJson.talk ?? {};
    if (talk[targetId]) return { ok: false, error: "already_answered" } as const;
    const record = talkRecord(session, targetId);
    if (target.reference && !record.fallback) return { ok: false, error: "judged_target" } as const;
    const cap = GRADE_BY_HELP[record.help];
    const capped = GRADE_RANK[cap] < GRADE_RANK[grade.grade] ? cap : grade.grade;
    await tx
      .update(schema.practiceSessions)
      .set({
        resultsJson: { ...session.resultsJson, talk: { ...talk, [targetId]: { ...grade, grade: capped } } },
        updatedAt: new Date(),
      })
      .where(eq(schema.practiceSessions.id, session.id));
    return { ok: true, session: toPracticeDto(await completeIfDone(tx, session.id)) } as const;
  });
}

/**
 * "I did say that" on a settled question: the judge reads every reply again,
 * at the user's reasoning level, and says which reply first stated each
 * point. The grade only goes up, capped by the help given before those
 * replies. Once per question; a finished session is scored again.
 */
export async function disputeTalkGrade(args: {
  userId: string;
  sessionId: string;
  targetId: string;
  model: LanguageModel;
  settings: AiRuntimeSettings;
}): Promise<PracticeResult> {
  const session = await loadOwned(args.userId, args.sessionId);
  if (!session) return { ok: false, error: "practice_not_found" };
  const target = (session.targetsJson ?? []).find((candidate) => candidate.id === args.targetId);
  if (!target) return { ok: false, error: "target_not_found" };
  const grade = session.resultsJson.talk?.[target.id];
  const record = session.resultsJson.talkState?.[target.id];
  const reference = target.reference;
  if (!reference || !grade || !record || record.fallback || !canDispute(grade.grade, record) || session.status === "abandoned") {
    return { ok: false, error: "not_disputable" };
  }

  const reading = await judgeDispute(args, {
    problem: await loadJudgeProblem(args.userId, session.problemId),
    question: judgeQuestion(target),
    reference,
    log: record.log,
  });
  const learnerHelp = record.log.filter((entry) => entry.role === "learner").map((entry) => entry.help ?? 2);
  const approach =
    reference.approaches.find((candidate) => candidate.id === reading.approachId) ??
    (reference.mode === "avoid_mistake" ? reference.approaches[0] : undefined);
  let regraded: { grade: TalkGrade; help: TalkHelp; by: TalkSettledBy; covered: string[] } | null = null;
  if (approach) {
    const first = approach.points.map((point) => reading.points.find((entry) => entry.id === point.id)?.firstReply ?? null);
    if (first.every((reply) => reply !== null)) {
      const help = Math.max(...first.map((reply) => learnerHelp[reply! - 1] ?? 2)) as TalkHelp;
      regraded = { grade: GRADE_BY_HELP[help], help, by: "complete", covered: approach.points.map((point) => point.id) };
    }
  } else if (reading.newApproachComplete) {
    const help = (learnerHelp.at(-1) ?? 2) as TalkHelp;
    regraded = { grade: GRADE_BY_HELP[help], help, by: "new_approach", covered: [] };
  }
  const upgrade = regraded && GRADE_RANK[regraded.grade] > GRADE_RANK[grade.grade] ? regraded : null;

  const updated = await getDb().transaction(async (tx) => {
    const [fresh] = await tx
      .select()
      .from(schema.practiceSessions)
      .where(eq(schema.practiceSessions.id, session.id))
      .limit(1);
    if (!fresh) return null;
    const freshRecord = fresh.resultsJson.talkState?.[target.id] ?? record;
    const resultsJson = {
      ...fresh.resultsJson,
      talkState: {
        ...fresh.resultsJson.talkState,
        [target.id]: {
          ...freshRecord,
          disputed: true,
          ...(upgrade
            ? { help: upgrade.help, settledBy: upgrade.by, covered: upgrade.covered, approachId: approach?.id ?? null }
            : {}),
        },
      },
      ...(upgrade
        ? {
            talk: {
              ...fresh.resultsJson.talk,
              [target.id]: { grade: upgrade.grade, reason: `${settleReason(upgrade.by, upgrade.help)} (re-checked)` },
            },
          }
        : {}),
    };
    await tx
      .update(schema.practiceSessions)
      .set({ resultsJson, updatedAt: new Date() })
      .where(eq(schema.practiceSessions.id, session.id));
    const changed = { ...fresh, resultsJson };
    if (!upgrade || fresh.status !== "completed") return changed;
    return rescoreTalk(tx, changed, target, upgrade.grade);
  });
  if (!updated) return { ok: false, error: "practice_not_found" };
  return { ok: true, session: toPracticeDto(updated) };
}

/** A finished session after a disputed grade went up: scored again, and the
 *  weak spot it covered updated as if that had been the grade. */
async function rescoreTalk(tx: Tx, session: PracticeSession, target: PracticeTarget, grade: TalkGrade) {
  const now = new Date();
  if (target.kind === "weakness" && target.weaknessId) {
    await applyWeaknessResult(tx, session, target.weaknessId, grade, now, session.resultsJson.weaknessBefore?.[target.id]);
  }
  const { score, rating } = scoreTalk(talkGrades(session), { endedEarly: session.resultsJson.endedEarly });
  const [rescored] = await tx
    .update(schema.practiceSessions)
    .set({ score, suggestedRating: rating, updatedAt: now })
    .where(eq(schema.practiceSessions.id, session.id))
    .returning();
  return rescored ?? session;
}

function talkGrades(session: PracticeSession) {
  const talk = session.resultsJson.talk ?? {};
  return (session.targetsJson ?? [])
    .filter((target) => talk[target.id])
    .map((target) => ({ grade: talk[target.id]!.grade, approach: target.kind === "core" && target.label === "approach" }));
}

/** Applies one practice result to a weak spot: correct twice in later
 *  sessions resolves it, a miss counts as a repeat, partial resets the
 *  streak. `before` replays it from the state this session started from.
 *  Returns that starting state, or null when the weak spot is gone. */
async function applyWeaknessResult(
  tx: Tx,
  session: PracticeSession,
  weaknessId: string,
  result: TalkGrade,
  now: Date,
  before?: WeaknessSnapshot,
): Promise<WeaknessSnapshot | null> {
  const [weakness] = await tx
    .select()
    .from(schema.weaknesses)
    .where(and(eq(schema.weaknesses.id, weaknessId), eq(schema.weaknesses.userId, session.userId)))
    .limit(1);
  if (!weakness || weakness.status === "dismissed") return null;
  // A snapshot read back from results_json has its dates as strings.
  const base: WeaknessSnapshot = before
    ? {
        ...before,
        lastSeenAt: new Date(before.lastSeenAt),
        resolvedAt: before.resolvedAt ? new Date(before.resolvedAt) : null,
      }
    : {
        status: weakness.status,
        resolvedAt: weakness.resolvedAt,
        correctStreak: weakness.correctStreak,
        hitCount: weakness.hitCount,
        lastSeenAt: weakness.lastSeenAt,
        evidenceJson: weakness.evidenceJson,
      };
  let change: Partial<WeaknessSnapshot>;
  if (result === "correct") {
    const streak = base.correctStreak + 1;
    change =
      streak >= WEAKNESS_RESOLVE_STREAK
        ? { correctStreak: streak, status: "resolved", resolvedAt: now }
        : { correctStreak: streak };
  } else if (result === "missed") {
    change = {
      status: "active",
      resolvedAt: null,
      correctStreak: 0,
      hitCount: base.hitCount + 1,
      lastSeenAt: now,
      evidenceJson: [...base.evidenceJson, { kind: "practice" as const, ref: session.id }].slice(-10),
    };
  } else {
    change = { correctStreak: 0 };
  }
  await tx
    .update(schema.weaknesses)
    .set({ ...base, ...change, updatedAt: now })
    .where(eq(schema.weaknesses.id, weakness.id));
  return base;
}

/**
 * The user ends a session early. A talk-through with at least one grade
 * completes on those grades (the rest are skipped); anything else is
 * abandoned. Ending a session that already ended returns it as is.
 */
export async function endPractice(userId: string, sessionId: string): Promise<PracticeResult> {
  return getDb().transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(schema.practiceSessions)
      .where(and(eq(schema.practiceSessions.id, sessionId), eq(schema.practiceSessions.userId, userId)))
      .limit(1);
    if (!session) return { ok: false, error: "practice_not_found" } as const;
    if (session.status !== "active") return { ok: true, session: toPracticeDto(session) } as const;
    const graded = Object.keys(session.resultsJson.talk ?? {}).length;
    if (session.mode === "talk" && graded > 0) {
      return { ok: true, session: toPracticeDto(await finishTalk(tx, session, { endedEarly: true })) } as const;
    }
    const now = new Date();
    const [abandoned] = await tx
      .update(schema.practiceSessions)
      .set({
        status: "abandoned",
        resultsJson: { ...session.resultsJson, endedEarly: true },
        debriefedAt: now,
        completedAt: now,
        updatedAt: now,
      })
      .where(and(eq(schema.practiceSessions.id, session.id), eq(schema.practiceSessions.status, "active")))
      .returning();
    return { ok: true, session: toPracticeDto(abandoned ?? session) } as const;
  });
}

/** Scores a finished talk-through and updates the weak spots it covered:
 *  correct twice in later sessions resolves one; a miss counts as a repeat. */
async function completeTalkIfDone(tx: Tx, session: PracticeSession): Promise<PracticeSession> {
  const targets = session.targetsJson ?? [];
  const talk = session.resultsJson.talk ?? {};
  if (targets.length === 0 || !targets.every((target) => talk[target.id])) return session;
  return finishTalk(tx, session);
}

/** Scores the graded targets and updates their weak spots. Ungraded ones (the
 *  user ended early) count for nothing either way. */
async function finishTalk(
  tx: Tx,
  session: PracticeSession,
  options: { endedEarly?: boolean } = {},
): Promise<PracticeSession> {
  const talk = session.resultsJson.talk ?? {};
  const { score, rating } = scoreTalk(talkGrades(session), { endedEarly: options.endedEarly });
  const now = new Date();

  // Kept so a disputed grade can be applied again from the same start.
  const weaknessBefore: Record<string, WeaknessSnapshot> = {};
  for (const target of session.targetsJson ?? []) {
    if (target.kind !== "weakness" || !target.weaknessId || !talk[target.id]) continue;
    const before = await applyWeaknessResult(tx, session, target.weaknessId, talk[target.id]!.grade, now);
    if (before) weaknessBefore[target.id] = before;
  }
  const resultsJson = {
    ...session.resultsJson,
    weaknessBefore,
    ...(options.endedEarly ? { endedEarly: true } : {}),
  };

  const [completed] = await tx
    .update(schema.practiceSessions)
    .set({
      status: "completed",
      score,
      suggestedRating: rating,
      resultsJson,
      // The Coach summarizes in the same turn as the last grade; an early end
      // shows its summary in the panel.
      debriefedAt: now,
      completedAt: now,
      updatedAt: now,
    })
    .where(and(eq(schema.practiceSessions.id, session.id), eq(schema.practiceSessions.status, "active")))
    .returning();
  return completed ?? session;
}

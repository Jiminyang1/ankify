import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  WEAKNESS_RESOLVE_STREAK,
  computeWeaknessProfile,
  parseCards,
  scoreTalk,
  selectPracticeCards,
  selectPracticeTargets,
  suggestPracticeRating,
} from "@ankify/core";
import type { PracticeSessionDto } from "@ankify/contracts";
import { getDb, schema, type CardStat, type PracticeGrade, type PracticeSession } from "@ankify/db";
import { AiJobRequestError, getOwnedAiJob } from "@/server/ai-generation/jobs";
import { startAiJobForUser } from "@/server/ai-generation/start";

/**
 * Practice sessions (docs/coach-practice.md): cards from the problem's Cards
 * doc, then generated check questions, then a suggested rating. All rules
 * live here and in packages/core/src/practice.ts; the model only writes the
 * check questions (ai-generation/practice-check.ts).
 */

export type PracticeError =
  | "problem_not_found"
  | "practice_not_found"
  | "practice_not_active"
  | "nothing_to_practice"
  | "card_not_in_session"
  | "check_not_ready"
  | "item_not_found"
  | "already_answered"
  | "target_not_found";

export type PracticeResult = { ok: true; session: PracticeSessionDto } | { ok: false; error: PracticeError; message?: string };

export const PRACTICE_ERROR_STATUS: Record<PracticeError, number> = {
  problem_not_found: 404,
  practice_not_found: 404,
  practice_not_active: 409,
  nothing_to_practice: 400,
  card_not_in_session: 400,
  check_not_ready: 409,
  item_not_found: 404,
  already_answered: 409,
  target_not_found: 404,
};

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export function toPracticeDto(session: PracticeSession): PracticeSessionDto {
  const results = session.resultsJson;
  const talk = results.talk ?? {};
  return {
    id: session.id,
    problemId: session.problemId,
    status: session.status,
    mode: session.mode,
    targets: (session.targetsJson ?? []).map((target) => ({
      id: target.id,
      kind: target.kind,
      category: target.category ?? null,
      label: target.label,
      grade: talk[target.id] ?? null,
    })),
    recall: session.recallJson.map((card) => ({ ...card, result: results.recall[card.key] ?? null })),
    check: {
      status: session.checkStatus,
      message: session.checkMessage,
      items: (session.checkJson ?? []).map((item) => {
        const answered = results.check[item.id];
        return {
          id: item.id,
          question: item.question,
          choices: item.choices,
          scope: item.scope,
          source: item.source,
          answer: answered
            ? { ...answered, answerIndex: item.answerIndex, explanation: item.explanation }
            : null,
        };
      }),
    },
    score: session.score,
    suggestedRating: (session.suggestedRating as 1 | 2 | 3 | 4 | null) ?? null,
    createdAt: session.createdAt.toISOString(),
    completedAt: session.completedAt?.toISOString() ?? null,
  };
}

async function loadOwned(userId: string, sessionId: string) {
  const [session] = await getDb()
    .select()
    .from(schema.practiceSessions)
    .where(and(eq(schema.practiceSessions.id, sessionId), eq(schema.practiceSessions.userId, userId)))
    .limit(1);
  return session ?? null;
}

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
  return session ?? null;
}

/** Starts a session, or returns the one already active for this problem. */
/** Starts a talk-through session (docs/coach-practice.md, version 2): the
 *  targets come from the problem's weak spots and the user's weak categories;
 *  the Coach asks and grades in the chat. */
async function startTalkPractice(userId: string, problemId: string, agentRunId?: string): Promise<PracticeResult> {
  const db = getDb();
  const existing = await loadActive(userId, problemId);
  if (existing) return { ok: true, session: toPracticeDto(existing) };
  const all = await db
    .select({
      id: schema.weaknesses.id,
      problemId: schema.weaknesses.problemId,
      category: schema.weaknesses.category,
      detail: schema.weaknesses.detail,
      status: schema.weaknesses.status,
      hitCount: schema.weaknesses.hitCount,
      lastSeenAt: schema.weaknesses.lastSeenAt,
      resolvedAt: schema.weaknesses.resolvedAt,
    })
    .from(schema.weaknesses)
    .where(eq(schema.weaknesses.userId, userId));
  const targets = selectPracticeTargets({
    problemWeaknesses: all.filter((w) => w.problemId === problemId && w.status === "active"),
    weakCategories: computeWeaknessProfile(all)
      .filter((entry) => entry.active > 0)
      .map((entry) => entry.category),
  });
  const id = nanoid(16);
  const now = new Date();
  const inserted = await db
    .insert(schema.practiceSessions)
    .values({
      id,
      userId,
      problemId,
      agentRunId: agentRunId ?? null,
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

export async function startPractice(
  userId: string,
  problemId: string,
  options: { agentRunId?: string; mode?: "talk" | "recall_check" } = {},
): Promise<PracticeResult> {
  if ((options.mode ?? "talk") === "talk") {
    const [owned] = await getDb()
      .select({ id: schema.problems.id })
      .from(schema.problems)
      .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, userId)))
      .limit(1);
    if (!owned) return { ok: false, error: "problem_not_found" };
    return startTalkPractice(userId, problemId, options.agentRunId);
  }
  const db = getDb();
  const [problem] = await db
    .select({ id: schema.problems.id, cardsMd: schema.problems.cardsMd, cardStats: schema.problems.cardStats })
    .from(schema.problems)
    .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, userId)))
    .limit(1);
  if (!problem) return { ok: false, error: "problem_not_found" };

  const existing = await loadActive(userId, problemId);
  if (existing) return { ok: true, session: toPracticeDto(await reconcile(existing)) };

  const recall = selectPracticeCards(parseCards(problem.cardsMd).cards, problem.cardStats).map(
    ({ key, prompt, answer }) => ({ key, prompt, answer }),
  );
  const id = nanoid(16);
  const now = new Date();
  const inserted = await db
    .insert(schema.practiceSessions)
    .values({
      id,
      userId,
      problemId,
      agentRunId: options.agentRunId ?? null,
      recallJson: recall,
      checkStatus: "pending",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: schema.practiceSessions.id });
  if (inserted.length === 0) {
    // Another request started one at the same moment.
    const raced = await loadActive(userId, problemId);
    if (raced) return { ok: true, session: toPracticeDto(raced) };
    return { ok: false, error: "practice_not_found" };
  }

  try {
    const job = await startAiJobForUser(userId, {
      action: "practice_check",
      problemId,
      requestId: crypto.randomUUID(),
      practiceSessionId: id,
    });
    await db
      .update(schema.practiceSessions)
      .set({ checkJobId: job.id, updatedAt: new Date() })
      .where(eq(schema.practiceSessions.id, id));
  } catch (error) {
    const message =
      error instanceof AiJobRequestError ? error.message : "Couldn't start the AI questions for this session.";
    if (recall.length === 0) {
      await db.delete(schema.practiceSessions).where(eq(schema.practiceSessions.id, id));
      return { ok: false, error: "nothing_to_practice", message };
    }
    await db
      .update(schema.practiceSessions)
      .set({ checkStatus: "skipped", checkMessage: message, updatedAt: new Date() })
      .where(eq(schema.practiceSessions.id, id));
  }
  const session = await loadOwned(userId, id);
  return { ok: true, session: toPracticeDto(session!) };
}

/** A pending check whose job ended without questions becomes "failed", so
 *  the session can finish with cards only. */
async function reconcile(session: PracticeSession): Promise<PracticeSession> {
  // Reads are polled; they only write when there's something to finish.
  // A talk-through completes when its last answer is graded, never here.
  if (session.status !== "active" || session.mode === "talk") return session;
  // The worker marks failed questions without re-checking completion.
  if (session.checkStatus === "failed" || session.checkStatus === "skipped") {
    const recallDone = session.recallJson.every((card) => session.resultsJson.recall[card.key]);
    if (!recallDone) return session;
    return getDb().transaction((tx) => completeIfDone(tx, session.id));
  }
  if (session.checkStatus !== "pending") return session;
  const job = session.checkJobId ? await getOwnedAiJob(session.userId, session.checkJobId) : null;
  const stuck = !session.checkJobId && Date.now() - session.createdAt.getTime() > 60_000;
  const ended = job && ["failed", "cancelled", "superseded"].includes(job.status);
  if (!stuck && !ended) return session;
  const message = job?.errorMessage ?? "The questions couldn't be generated.";
  return getDb().transaction(async (tx) => {
    await tx
      .update(schema.practiceSessions)
      .set({ checkStatus: "failed", checkMessage: message, updatedAt: new Date() })
      .where(and(eq(schema.practiceSessions.id, session.id), eq(schema.practiceSessions.checkStatus, "pending")));
    return completeIfDone(tx, session.id);
  });
}

export async function getPractice(userId: string, sessionId: string): Promise<PracticeResult> {
  const session = await loadOwned(userId, sessionId);
  if (!session) return { ok: false, error: "practice_not_found" };
  return { ok: true, session: toPracticeDto(await reconcile(session)) };
}

/** The active session for a problem, or the latest one finished but not yet
 *  debriefed, so the panel can resume either. */
export async function getCurrentPractice(userId: string, problemId: string): Promise<PracticeSessionDto | null> {
  const [latest] = await getDb()
    .select()
    .from(schema.practiceSessions)
    .where(and(eq(schema.practiceSessions.userId, userId), eq(schema.practiceSessions.problemId, problemId)))
    .orderBy(desc(schema.practiceSessions.createdAt))
    .limit(1);
  if (!latest) return null;
  if (latest.status === "active") return toPracticeDto(await reconcile(latest));
  if (latest.status === "completed" && !latest.debriefedAt) return toPracticeDto(latest);
  return null;
}

export async function recordRecall(
  userId: string,
  sessionId: string,
  key: string,
  result: "got_it" | "missed",
): Promise<PracticeResult> {
  return getDb().transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(schema.practiceSessions)
      .where(and(eq(schema.practiceSessions.id, sessionId), eq(schema.practiceSessions.userId, userId)))
      .limit(1);
    if (!session) return { ok: false, error: "practice_not_found" } as const;
    if (session.status !== "active") return { ok: false, error: "practice_not_active" } as const;
    if (!session.recallJson.some((card) => card.key === key)) return { ok: false, error: "card_not_in_session" } as const;
    if (session.resultsJson.recall[key]) return { ok: false, error: "already_answered" } as const;

    const now = new Date();
    await tx
      .update(schema.practiceSessions)
      .set({
        resultsJson: { ...session.resultsJson, recall: { ...session.resultsJson.recall, [key]: result } },
        updatedAt: now,
      })
      .where(eq(schema.practiceSessions.id, session.id));
    await updateCardStat(tx, userId, session.problemId, key, result, now);
    return { ok: true, session: toPracticeDto(await completeIfDone(tx, session.id)) } as const;
  });
}

export async function answerCheck(
  userId: string,
  sessionId: string,
  itemId: string,
  choice: number,
): Promise<PracticeResult> {
  return getDb().transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(schema.practiceSessions)
      .where(and(eq(schema.practiceSessions.id, sessionId), eq(schema.practiceSessions.userId, userId)))
      .limit(1);
    if (!session) return { ok: false, error: "practice_not_found" } as const;
    if (session.status !== "active") return { ok: false, error: "practice_not_active" } as const;
    if (session.checkStatus !== "ready") return { ok: false, error: "check_not_ready" } as const;
    const item = (session.checkJson ?? []).find((candidate) => candidate.id === itemId);
    if (!item) return { ok: false, error: "item_not_found" } as const;
    if (session.resultsJson.check[itemId]) return { ok: false, error: "already_answered" } as const;

    await tx
      .update(schema.practiceSessions)
      .set({
        resultsJson: {
          ...session.resultsJson,
          check: { ...session.resultsJson.check, [itemId]: { choice, correct: choice === item.answerIndex } },
        },
        updatedAt: new Date(),
      })
      .where(eq(schema.practiceSessions.id, session.id));
    return { ok: true, session: toPracticeDto(await completeIfDone(tx, session.id)) } as const;
  });
}

async function updateCardStat(
  tx: Tx,
  userId: string,
  problemId: string,
  key: string,
  result: "got_it" | "missed",
  now: Date,
) {
  const [problem] = await tx
    .select({ cardStats: schema.problems.cardStats })
    .from(schema.problems)
    .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, userId)))
    .limit(1);
  if (!problem) return;
  const previous: CardStat | undefined = problem.cardStats[key];
  const next: CardStat = {
    lastShownAt: now.toISOString(),
    lastResult: result,
    missCount: (previous?.missCount ?? 0) + (result === "missed" ? 1 : 0),
  };
  await tx
    .update(schema.problems)
    .set({ cardStats: { ...problem.cardStats, [key]: next } })
    .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, userId)));
}

/** Finishes the session once every card and question has an answer (or the
 *  questions failed), with the score and suggested rating. */
async function completeIfDone(tx: Tx, sessionId: string): Promise<PracticeSession> {
  const [session] = await tx
    .select()
    .from(schema.practiceSessions)
    .where(eq(schema.practiceSessions.id, sessionId))
    .limit(1);
  if (!session || session.status !== "active") return session!;
  if (session.mode === "talk") return completeTalkIfDone(tx, session);
  const { recall, check } = session.resultsJson;
  const checkItems = session.checkStatus === "ready" ? (session.checkJson ?? []) : [];
  const recallDone = session.recallJson.every((card) => recall[card.key]);
  const checkDone =
    session.checkStatus === "failed" ||
    session.checkStatus === "skipped" ||
    (session.checkStatus === "ready" && checkItems.every((item) => check[item.id]));
  if (!recallDone || !checkDone) return session;

  const total = session.recallJson.length + checkItems.length;
  const points =
    session.recallJson.filter((card) => recall[card.key] === "got_it").length +
    checkItems.filter((item) => check[item.id]?.correct).length;
  const now = new Date();
  const [completed] = await tx
    .update(schema.practiceSessions)
    .set({
      status: "completed",
      score: total > 0 ? points / total : null,
      suggestedRating: suggestPracticeRating(points, total),
      completedAt: now,
      updatedAt: now,
    })
    .where(and(eq(schema.practiceSessions.id, sessionId), eq(schema.practiceSessions.status, "active")))
    .returning();
  return completed ?? session;
}

export async function markPracticeDebriefed(userId: string, sessionId: string) {
  await getDb()
    .update(schema.practiceSessions)
    .set({ debriefedAt: new Date() })
    .where(and(eq(schema.practiceSessions.id, sessionId), eq(schema.practiceSessions.userId, userId)));
}

/** What the Coach gets for a debrief: score, suggestion, and what was missed.
 *  null unless the session is completed. */
export async function getPracticeDebrief(userId: string, sessionId: string) {
  const session = await loadOwned(userId, sessionId);
  if (!session || session.status !== "completed") return null;
  const { recall, check } = session.resultsJson;
  const missed = [
    ...session.recallJson
      .filter((card) => recall[card.key] === "missed")
      .map((card) => `Card [${card.key}] "${card.prompt}" (answer: ${card.answer.slice(0, 300)})`),
    ...(session.checkJson ?? [])
      .filter((item) => check[item.id] && !check[item.id]!.correct)
      .map(
        (item) =>
          `Question "${item.question}" (scope ${item.scope}, source ${item.source.kind}${item.source.ref ? ` ${item.source.ref}` : ""}); picked "${item.choices[check[item.id]!.choice]}", correct "${item.choices[item.answerIndex]}". ${item.explanation}`.slice(
            0,
            1_500,
          ),
      ),
  ];
  return {
    practiceSessionId: session.id,
    problemId: session.problemId,
    score: session.score ?? 0,
    suggestedRating: (session.suggestedRating ?? 3) as 1 | 2 | 3 | 4,
    missed: missed.slice(0, 10),
  };
}

/* ── Talk-through grading ── */

/** The active talk-through session on a problem, as the Coach sees it. */
export async function getActiveTalkContext(userId: string, problemId: string) {
  const session = await loadActive(userId, problemId);
  if (!session || session.mode !== "talk") return null;
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
  };
}

/** The Coach's grade for one target. The last grade completes the session. */
export async function gradeTalkTarget(
  userId: string,
  problemId: string,
  targetId: string,
  grade: PracticeGrade,
): Promise<PracticeResult> {
  return getDb().transaction(async (tx) => {
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
    if (!session || session.mode !== "talk") return { ok: false, error: "practice_not_active" } as const;
    if (!(session.targetsJson ?? []).some((target) => target.id === targetId)) {
      return { ok: false, error: "target_not_found" } as const;
    }
    const talk = session.resultsJson.talk ?? {};
    if (talk[targetId]) return { ok: false, error: "already_answered" } as const;
    await tx
      .update(schema.practiceSessions)
      .set({
        resultsJson: { ...session.resultsJson, talk: { ...talk, [targetId]: grade } },
        updatedAt: new Date(),
      })
      .where(eq(schema.practiceSessions.id, session.id));
    return { ok: true, session: toPracticeDto(await completeIfDone(tx, session.id)) } as const;
  });
}

/** Scores a finished talk-through and updates the weak spots it covered:
 *  correct twice in later sessions resolves one; a miss counts as a repeat. */
async function completeTalkIfDone(tx: Tx, session: PracticeSession): Promise<PracticeSession> {
  const targets = session.targetsJson ?? [];
  const talk = session.resultsJson.talk ?? {};
  if (targets.length === 0 || !targets.every((target) => talk[target.id])) return session;
  const { score, rating } = scoreTalk(targets.map((target) => talk[target.id]!.grade));
  const now = new Date();

  for (const target of targets) {
    if (target.kind !== "weakness" || !target.weaknessId) continue;
    const [weakness] = await tx
      .select()
      .from(schema.weaknesses)
      .where(and(eq(schema.weaknesses.id, target.weaknessId), eq(schema.weaknesses.userId, session.userId)))
      .limit(1);
    if (!weakness || weakness.status === "dismissed") continue;
    const result = talk[target.id]!.grade;
    if (result === "correct") {
      const streak = weakness.correctStreak + 1;
      const resolved = streak >= WEAKNESS_RESOLVE_STREAK;
      await tx
        .update(schema.weaknesses)
        .set({
          correctStreak: streak,
          ...(resolved ? { status: "resolved" as const, resolvedAt: now } : {}),
          updatedAt: now,
        })
        .where(eq(schema.weaknesses.id, weakness.id));
    } else if (result === "missed") {
      await tx
        .update(schema.weaknesses)
        .set({
          status: "active",
          resolvedAt: null,
          correctStreak: 0,
          hitCount: weakness.hitCount + 1,
          lastSeenAt: now,
          evidenceJson: [...weakness.evidenceJson, { kind: "practice" as const, ref: session.id }].slice(-10),
          updatedAt: now,
        })
        .where(eq(schema.weaknesses.id, weakness.id));
    } else {
      await tx
        .update(schema.weaknesses)
        .set({ correctStreak: 0, updatedAt: now })
        .where(eq(schema.weaknesses.id, weakness.id));
    }
  }

  const [completed] = await tx
    .update(schema.practiceSessions)
    .set({
      status: "completed",
      score,
      suggestedRating: rating,
      // The Coach summarizes in the same turn as the last grade.
      debriefedAt: now,
      completedAt: now,
      updatedAt: now,
    })
    .where(and(eq(schema.practiceSessions.id, session.id), eq(schema.practiceSessions.status, "active")))
    .returning();
  return completed ?? session;
}

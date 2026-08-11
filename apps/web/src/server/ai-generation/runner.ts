import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { AiJobCreateRequestInput, CardDraft, QuizItem } from "@ankify/contracts";
import { getDb, schema, type AiJob } from "@ankify/db";
import { MAX_CARDS_PER_PROBLEM, MAX_QUIZ_SESSIONS_PER_PROBLEM } from "@/server/resource-limits";
import { classifyAiJobError, logAiJobError } from "./errors";
import { generateAiCardDraft } from "./card";
import {
  assertJobConfiguration,
  claimAiJob,
  decryptJobInput,
  failAiJob,
  requeueAiJob,
} from "./jobs";
import { generateQuizItems, getRecentCompletedQuizSessions } from "./quiz";

type AiJobProcessResult =
  | { state: "done" }
  | { state: "retry"; delaySeconds: number };

/**
 * Processes one at-least-once delivery. Business writes and the terminal job
 * transition share one transaction, so a redelivery can never create a second
 * card or quiz session after a successful commit.
 */
export async function processAiJob(jobId: string, workerId: string): Promise<AiJobProcessResult> {
  const claim = await claimAiJob(jobId, workerId);
  if (!claim || claim.state === "terminal") return { state: "done" };
  if (claim.state === "busy") return { state: "retry", delaySeconds: 30 };

  const job = claim.job;
  try {
    await assertJobConfiguration(job);
    const input = decryptJobInput(job);
    if (input.action === "card_generate" || input.action === "card_followup") {
      await runCardJob(job, input);
    } else {
      await runQuizJob(job, input);
    }
    return { state: "done" };
  } catch (error) {
    const classified = classifyAiJobError(error);
    logAiJobError(job.id, error);
    if (classified.retryable && job.attempt < job.maxAttempts) {
      const delaySeconds = await requeueAiJob(job, classified.code, classified.message);
      return { state: "retry", delaySeconds };
    }
    await failAiJob(job, classified.code, classified.message);
    return { state: "done" };
  }
}

async function runCardJob(
  job: AiJob,
  input: Extract<AiJobCreateRequestInput, { action: "card_generate" | "card_followup" }>,
) {
  const draft = await generateAiCardDraft({
    userId: job.userId,
    problemId: job.problemId,
    action: input.action === "card_generate" ? "generate" : "followup",
    rawText: input.action === "card_generate" ? input.rawText?.trim() || undefined : undefined,
    draft: input.action === "card_followup" ? input.draft : undefined,
    instruction: input.action === "card_followup" ? input.instruction.trim() : undefined,
  });

  if (input.action === "card_generate") {
    await commitGeneratedCard(job, draft);
  } else {
    await commitFollowupCard(job, input, draft);
  }
}

async function commitGeneratedCard(job: AiJob, draft: CardDraft) {
  const db = getDb();
  const now = new Date();
  const cardId = `aic_${job.id}`;
  await db.transaction(async (tx) => {
    const currentJob = await loadRunningJob(tx, job);
    if (!currentJob) return;

    const [{ count } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(schema.cards)
      .where(and(eq(schema.cards.userId, job.userId), eq(schema.cards.problemId, job.problemId)));
    if (count >= MAX_CARDS_PER_PROBLEM) throw new Error("card_limit_reached");

    await tx.insert(schema.cards).values({
      id: cardId,
      userId: job.userId,
      problemId: job.problemId,
      aiStatus: "candidate",
      errorMessage: null,
      question: draft.question,
      answer: draft.answer,
      createdAt: now,
      updatedAt: now,
    });
    await markSucceeded(tx, job, { resultCardId: cardId }, now);
  });
}

async function commitFollowupCard(
  job: AiJob,
  input: Extract<AiJobCreateRequestInput, { action: "card_followup" }>,
  draft: CardDraft,
) {
  const db = getDb();
  const now = new Date();
  await db.transaction(async (tx) => {
    const currentJob = await loadRunningJob(tx, job);
    if (!currentJob) return;

    const [updated] = await tx
      .update(schema.cards)
      .set({
        aiStatus: "candidate",
        errorMessage: null,
        question: draft.question,
        answer: draft.answer,
        version: sql`${schema.cards.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.cards.id, input.cardId),
          eq(schema.cards.userId, job.userId),
          eq(schema.cards.problemId, job.problemId),
          eq(schema.cards.version, input.expectedCardVersion),
          ne(schema.cards.aiStatus, "ready"),
        ),
      )
      .returning({ id: schema.cards.id });

    if (!updated) {
      await markSuperseded(tx, job, "card_version_conflict", "Card changed elsewhere. Refresh and retry.", now);
      return;
    }
    await markSucceeded(tx, job, { resultCardId: updated.id }, now);
  });
}

async function runQuizJob(
  job: AiJob,
  input: Extract<AiJobCreateRequestInput, { action: "quiz_generate" | "quiz_regenerate" | "quiz_next_batch" }>,
) {
  const history = input.action === "quiz_next_batch"
    ? await getRecentCompletedQuizSessions(job.userId, job.problemId)
    : [];
  const items = await generateQuizItems(job.userId, job.problemId, history);
  await commitQuiz(job, input, items);
}

async function commitQuiz(
  job: AiJob,
  input: Extract<AiJobCreateRequestInput, { action: "quiz_generate" | "quiz_regenerate" | "quiz_next_batch" }>,
  items: QuizItem[],
) {
  const db = getDb();
  const now = new Date();
  const sessionId = `aiq_${job.id}`;
  await db.transaction(async (tx) => {
    const currentJob = await loadRunningJob(tx, job);
    if (!currentJob) return;

    const [current] = await tx
      .select()
      .from(schema.quizSessions)
      .where(
        and(
          eq(schema.quizSessions.userId, job.userId),
          eq(schema.quizSessions.problemId, job.problemId),
          ne(schema.quizSessions.status, "archived"),
        ),
      )
      .orderBy(desc(schema.quizSessions.createdAt))
      .limit(1);

    if (input.action === "quiz_generate" && current) {
      await markSucceeded(tx, job, { resultQuizSessionId: current.id }, now);
      return;
    }
    if (
      input.action !== "quiz_generate" &&
      (current?.id ?? null) !== job.expectedQuizSessionId
    ) {
      await markSuperseded(tx, job, "quiz_session_conflict", "Quiz state changed elsewhere. Refresh and retry.", now);
      return;
    }
    if (input.action === "quiz_next_batch" && current?.status !== "completed") {
      await markSuperseded(tx, job, "quiz_session_not_completed", "Complete the current quiz first.", now);
      return;
    }

    if (current && input.action !== "quiz_generate") {
      await tx
        .update(schema.quizSessions)
        .set({ status: "archived", updatedAt: now })
        .where(
          and(
            eq(schema.quizSessions.id, current.id),
            eq(schema.quizSessions.userId, job.userId),
            ne(schema.quizSessions.status, "archived"),
          ),
        );
    }

    const [{ count } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(schema.quizSessions)
      .where(
        and(
          eq(schema.quizSessions.userId, job.userId),
          eq(schema.quizSessions.problemId, job.problemId),
        ),
      );
    const pruneCount = Math.max(0, count - MAX_QUIZ_SESSIONS_PER_PROBLEM + 1);
    if (pruneCount > 0) {
      const expired = await tx
        .select({ id: schema.quizSessions.id })
        .from(schema.quizSessions)
        .where(
          and(
            eq(schema.quizSessions.userId, job.userId),
            eq(schema.quizSessions.problemId, job.problemId),
            eq(schema.quizSessions.status, "archived"),
          ),
        )
        .orderBy(asc(schema.quizSessions.createdAt))
        .limit(pruneCount);
      if (expired.length < pruneCount) throw new Error("quiz_session_limit_reached");
      await tx
        .delete(schema.quizSessions)
        .where(inArray(schema.quizSessions.id, expired.map((session) => session.id)));
    }

    await tx.insert(schema.quizSessions).values({
      id: sessionId,
      userId: job.userId,
      problemId: job.problemId,
      status: "active",
      itemsJson: items,
      answersJson: [],
      score: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    });
    await markSucceeded(tx, job, { resultQuizSessionId: sessionId }, now);
  });
}

type AiJobTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function loadRunningJob(tx: AiJobTransaction, job: AiJob) {
  const [current] = await tx
    .select()
    .from(schema.aiJobs)
    .where(
      and(
        eq(schema.aiJobs.id, job.id),
        eq(schema.aiJobs.status, "running"),
        eq(schema.aiJobs.workerId, job.workerId!),
      ),
    )
    .limit(1);
  return current ?? null;
}

async function markSucceeded(
  tx: AiJobTransaction,
  job: AiJob,
  result: { resultCardId?: string; resultQuizSessionId?: string },
  now: Date,
) {
  await tx
    .update(schema.aiJobs)
    .set({
      status: "succeeded",
      activeDedupKey: null,
      workerId: null,
      leaseExpiresAt: null,
      resultCardId: result.resultCardId ?? null,
      resultQuizSessionId: result.resultQuizSessionId ?? null,
      errorCode: null,
      errorMessage: null,
      finishedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.aiJobs.id, job.id),
        eq(schema.aiJobs.status, "running"),
        eq(schema.aiJobs.workerId, job.workerId!),
      ),
    );
}

async function markSuperseded(
  tx: AiJobTransaction,
  job: AiJob,
  code: string,
  message: string,
  now: Date,
) {
  await tx
    .update(schema.aiJobs)
    .set({
      status: "superseded",
      activeDedupKey: null,
      workerId: null,
      leaseExpiresAt: null,
      errorCode: code,
      errorMessage: message,
      finishedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.aiJobs.id, job.id),
        eq(schema.aiJobs.status, "running"),
        eq(schema.aiJobs.workerId, job.workerId!),
      ),
    );
}

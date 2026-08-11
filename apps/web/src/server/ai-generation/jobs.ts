import { and, desc, eq, gt, inArray, lte, ne, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  aiJobCreateRequestSchema,
  type AiJobCreateRequestInput,
  type PublicAiJobDto,
} from "@ankify/contracts";
import { getDb, schema, type AiJob } from "@ankify/db";
import { MAX_CARDS_PER_PROBLEM } from "@/server/resource-limits";
import { decryptSecret, encryptSecret, type EncryptedSecret } from "@/server/secret-box";
import { getAiSettings, getGenerationSettings } from "@/server/settings";
import { getCurrentQuizSession } from "./quiz";

const MAX_ACTIVE_JOBS_PER_USER = 10;
const JOB_LEASE_MS = 270_000;
const TERMINAL_STATUSES = ["succeeded", "failed", "cancelled", "superseded"] as const;
const ACTIVE_STATUSES = ["queued", "running"] as const;

export class AiJobRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "AiJobRequestError";
  }
}

export function toPublicAiJob(job: AiJob): PublicAiJobDto {
  return {
    id: job.id,
    problemId: job.problemId,
    kind: job.kind,
    action: job.action,
    status: job.status,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    resultCardId: job.resultCardId,
    resultQuizSessionId: job.resultQuizSessionId,
    targetCardId: job.expectedCardId,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    queuedAt: job.queuedAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

export async function createAiJob(userId: string, input: AiJobCreateRequestInput): Promise<AiJob> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.aiJobs)
    .where(
      and(
        eq(schema.aiJobs.userId, userId),
        eq(schema.aiJobs.idempotencyKey, input.requestId),
      ),
    )
    .limit(1);
  if (existing) return existing;

  const [problem, ai, generation] = await Promise.all([
    db
      .select({ id: schema.problems.id })
      .from(schema.problems)
      .where(and(eq(schema.problems.id, input.problemId), eq(schema.problems.userId, userId)))
      .limit(1),
    getAiSettings(userId),
    getGenerationSettings(userId),
  ]);
  if (!problem[0]) {
    throw new AiJobRequestError("problem_not_found", "Problem not found.", 404);
  }
  if (!ai.provider || !ai.model) {
    throw new AiJobRequestError("ai_not_configured", "Configure an AI provider and model in Settings.", 400);
  }
  if (!ai.encryptedApiKey) {
    throw new AiJobRequestError("ai_key_missing", "Add your provider API key in Settings.", 400);
  }

  const precondition = await validateJobPrecondition(userId, input);
  const activeDedupKey = dedupKeyFor(input);
  if (precondition.existingQuizSessionId) {
    const now = new Date();
    const id = nanoid(16);
    await db.insert(schema.aiJobs).values({
      id,
      userId,
      problemId: input.problemId,
      kind: "quiz",
      action: "quiz_generate",
      status: "succeeded",
      idempotencyKey: input.requestId,
      activeDedupKey: null,
      inputEnvelope: encryptJobInput(input),
      provider: ai.provider,
      model: ai.model,
      reasoningMode: ai.reasoningMode,
      generationLanguage: generation.language,
      expectedQuizSessionId: precondition.expectedQuizSessionId,
      resultQuizSessionId: precondition.existingQuizSessionId,
      finishedAt: now,
      updatedAt: now,
    }).onConflictDoNothing();
    const [job] = await db
      .select()
      .from(schema.aiJobs)
      .where(
        and(
          eq(schema.aiJobs.userId, userId),
          eq(schema.aiJobs.idempotencyKey, input.requestId),
        ),
      )
      .limit(1);
    return job!;
  }

  const [activeForSlot] = await db
    .select()
    .from(schema.aiJobs)
    .where(
      and(
        eq(schema.aiJobs.userId, userId),
        eq(schema.aiJobs.activeDedupKey, activeDedupKey),
        inArray(schema.aiJobs.status, [...ACTIVE_STATUSES]),
      ),
    )
    .orderBy(desc(schema.aiJobs.createdAt))
    .limit(1);
  if (activeForSlot) {
    throw new AiJobRequestError(
      "ai_job_conflict",
      "Another AI generation is already active for this resource.",
      409,
    );
  }

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.aiJobs)
    .where(
      and(
        eq(schema.aiJobs.userId, userId),
        inArray(schema.aiJobs.status, [...ACTIVE_STATUSES]),
      ),
    );
  if (count >= MAX_ACTIVE_JOBS_PER_USER) {
    throw new AiJobRequestError(
      "ai_job_limit_reached",
      `You already have ${MAX_ACTIVE_JOBS_PER_USER} active AI jobs. Wait for one to finish.`,
      429,
    );
  }

  const now = new Date();
  const id = nanoid(16);
  await db
    .insert(schema.aiJobs)
    .values({
      id,
      userId,
      problemId: input.problemId,
      kind: input.action.startsWith("card_") ? "card" : "quiz",
      action: input.action,
      status: "queued",
      idempotencyKey: input.requestId,
      activeDedupKey,
      inputEnvelope: encryptJobInput(input),
      provider: ai.provider,
      model: ai.model,
      reasoningMode: ai.reasoningMode,
      generationLanguage: generation.language,
      expectedCardId: input.action === "card_followup" ? input.cardId : null,
      expectedCardVersion: input.action === "card_followup" ? input.expectedCardVersion : null,
      expectedQuizSessionId: precondition.expectedQuizSessionId,
      runAfter: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  const [created] = await db
    .select()
    .from(schema.aiJobs)
    .where(
      or(
        and(eq(schema.aiJobs.userId, userId), eq(schema.aiJobs.idempotencyKey, input.requestId)),
        and(eq(schema.aiJobs.userId, userId), eq(schema.aiJobs.activeDedupKey, activeDedupKey)),
      ),
    )
    .orderBy(desc(schema.aiJobs.createdAt))
    .limit(1);
  if (!created) {
    throw new AiJobRequestError("ai_job_create_failed", "Could not create AI job.", 500);
  }
  if (created.idempotencyKey !== input.requestId) {
    throw new AiJobRequestError(
      "ai_job_conflict",
      "Another AI generation is already active for this resource.",
      409,
    );
  }
  return created;
}

async function validateJobPrecondition(userId: string, input: AiJobCreateRequestInput) {
  const db = getDb();
  if (input.action === "card_generate") {
    const [{ count } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.cards)
      .where(and(eq(schema.cards.userId, userId), eq(schema.cards.problemId, input.problemId)));
    if (count >= MAX_CARDS_PER_PROBLEM) {
      throw new AiJobRequestError("card_limit_reached", "Delete a card before generating another.", 403);
    }
    return { expectedQuizSessionId: null, existingQuizSessionId: null };
  }

  if (input.action === "card_followup") {
    const [card] = await db
      .select()
      .from(schema.cards)
      .where(and(eq(schema.cards.id, input.cardId), eq(schema.cards.userId, userId)))
      .limit(1);
    if (!card || card.problemId !== input.problemId) {
      throw new AiJobRequestError("card_not_found", "Card not found.", 404);
    }
    if (card.aiStatus === "ready") {
      throw new AiJobRequestError("card_is_already_ready", "This card is already confirmed.", 400);
    }
    if (card.version !== input.expectedCardVersion) {
      throw new AiJobRequestError("card_version_conflict", "Card changed elsewhere. Refresh and retry.", 409);
    }
    return { expectedQuizSessionId: null, existingQuizSessionId: null };
  }

  const current = await getCurrentQuizSession(userId, input.problemId);
  if (input.expectedQuizSessionId !== (current?.id ?? null)) {
    throw new AiJobRequestError("quiz_session_conflict", "Quiz state changed elsewhere. Refresh and retry.", 409);
  }
  if (input.action === "quiz_generate" && current) {
    return { expectedQuizSessionId: current.id, existingQuizSessionId: current.id };
  }
  if (input.action === "quiz_next_batch" && current?.status !== "completed") {
    throw new AiJobRequestError("quiz_session_not_completed", "Complete the current quiz first.", 400);
  }
  return { expectedQuizSessionId: current?.id ?? null, existingQuizSessionId: null };
}

function dedupKeyFor(input: AiJobCreateRequestInput) {
  if (input.action === "card_followup") return `card-followup:${input.cardId}`;
  if (input.action === "card_generate") return `card-generate:${input.problemId}`;
  return `quiz:${input.problemId}`;
}

function encryptJobInput(input: AiJobCreateRequestInput) {
  return encryptSecret(JSON.stringify(input));
}

export function decryptJobInput(job: AiJob): AiJobCreateRequestInput {
  const raw = decryptSecret(job.inputEnvelope as EncryptedSecret);
  return aiJobCreateRequestSchema.parse(JSON.parse(raw));
}

export async function getOwnedAiJob(userId: string, jobId: string) {
  const db = getDb();
  const [job] = await db
    .select()
    .from(schema.aiJobs)
    .where(and(eq(schema.aiJobs.id, jobId), eq(schema.aiJobs.userId, userId)))
    .limit(1);
  return job ?? null;
}

export async function getOwnedAiJobByRequestId(userId: string, requestId: string) {
  const db = getDb();
  const [job] = await db
    .select()
    .from(schema.aiJobs)
    .where(
      and(
        eq(schema.aiJobs.userId, userId),
        eq(schema.aiJobs.idempotencyKey, requestId),
      ),
    )
    .limit(1);
  return job ?? null;
}

export async function listOwnedAiJobs(args: {
  userId: string;
  problemId: string;
  kind?: "card" | "quiz";
  activeOnly?: boolean;
}) {
  const db = getDb();
  return db
    .select()
    .from(schema.aiJobs)
    .where(
      and(
        eq(schema.aiJobs.userId, args.userId),
        eq(schema.aiJobs.problemId, args.problemId),
        args.kind ? eq(schema.aiJobs.kind, args.kind) : undefined,
        args.activeOnly ? inArray(schema.aiJobs.status, [...ACTIVE_STATUSES]) : undefined,
      ),
    )
    .orderBy(desc(schema.aiJobs.createdAt))
    .limit(20);
}

export async function cancelOwnedAiJob(userId: string, jobId: string) {
  const db = getDb();
  const now = new Date();
  const [job] = await db
    .update(schema.aiJobs)
    .set({
      status: "cancelled",
      activeDedupKey: null,
      cancelRequestedAt: now,
      workerId: null,
      leaseExpiresAt: null,
      finishedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.aiJobs.id, jobId),
        eq(schema.aiJobs.userId, userId),
        inArray(schema.aiJobs.status, [...ACTIVE_STATUSES]),
      ),
    )
    .returning();
  return job ?? getOwnedAiJob(userId, jobId);
}

export async function failQueuedAiJob(jobId: string, code: string, message: string) {
  const db = getDb();
  const now = new Date();
  await db
    .update(schema.aiJobs)
    .set({
      status: "failed",
      activeDedupKey: null,
      errorCode: code,
      errorMessage: message,
      finishedAt: now,
      updatedAt: now,
    })
    .where(and(eq(schema.aiJobs.id, jobId), eq(schema.aiJobs.status, "queued")));
}

type ClaimResult =
  | { state: "claimed"; job: AiJob }
  | { state: "busy"; job: AiJob }
  | { state: "terminal"; job: AiJob };

export async function claimAiJob(jobId: string, workerId: string): Promise<ClaimResult | null> {
  const db = getDb();
  const now = new Date();
  try {
    return await db.transaction(async (tx) => {
      const [job] = await tx
        .select()
        .from(schema.aiJobs)
        .where(eq(schema.aiJobs.id, jobId))
        .limit(1);
      if (!job) return null;
      if (TERMINAL_STATUSES.includes(job.status as (typeof TERMINAL_STATUSES)[number])) {
        return { state: "terminal", job };
      }
      if (job.attempt >= job.maxAttempts) {
        const [failed] = await tx
          .update(schema.aiJobs)
          .set({
            status: "failed",
            activeDedupKey: null,
            workerId: null,
            leaseExpiresAt: null,
            errorCode: "attempts_exhausted",
            errorMessage: "AI generation exhausted its retry limit.",
            finishedAt: now,
            updatedAt: now,
          })
          .where(eq(schema.aiJobs.id, job.id))
          .returning();
        return { state: "terminal", job: failed! };
      }
      if (job.status === "running" && job.leaseExpiresAt && job.leaseExpiresAt > now) {
        return { state: "busy", job };
      }
      if (job.runAfter > now) return { state: "busy", job };

      await tx
        .update(schema.aiJobs)
        .set({
          status: "queued",
          workerId: null,
          leaseExpiresAt: null,
          runAfter: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.aiJobs.userId, job.userId),
            eq(schema.aiJobs.status, "running"),
            ne(schema.aiJobs.id, job.id),
            lte(schema.aiJobs.leaseExpiresAt, now),
          ),
        );

      const [otherRunning] = await tx
        .select({ id: schema.aiJobs.id })
        .from(schema.aiJobs)
        .where(
          and(
            eq(schema.aiJobs.userId, job.userId),
            eq(schema.aiJobs.status, "running"),
            ne(schema.aiJobs.id, job.id),
            gt(schema.aiJobs.leaseExpiresAt, now),
          ),
        )
        .limit(1);
      if (otherRunning) return { state: "busy", job };

      const [claimed] = await tx
        .update(schema.aiJobs)
        .set({
          status: "running",
          attempt: sql`${schema.aiJobs.attempt} + 1`,
          workerId,
          leaseExpiresAt: new Date(now.getTime() + JOB_LEASE_MS),
          startedAt: job.startedAt ?? now,
          errorCode: null,
          errorMessage: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.aiJobs.id, job.id),
            or(
              eq(schema.aiJobs.status, "queued"),
              and(eq(schema.aiJobs.status, "running"), lte(schema.aiJobs.leaseExpiresAt, now)),
            ),
          ),
        )
        .returning();
      return claimed ? { state: "claimed", job: claimed } : { state: "busy", job };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      !message.includes("ai_jobs_user_running_unique") &&
      !message.includes("UNIQUE constraint failed: ai_jobs.user_id")
    ) throw error;
    const [job] = await db.select().from(schema.aiJobs).where(eq(schema.aiJobs.id, jobId)).limit(1);
    return job ? { state: "busy", job } : null;
  }
}

export async function requeueAiJob(job: AiJob, code: string, message: string) {
  const db = getDb();
  const now = new Date();
  const delaySeconds = Math.min(120, job.attempt <= 1 ? 30 : 120);
  await db
    .update(schema.aiJobs)
    .set({
      status: "queued",
      runAfter: new Date(now.getTime() + delaySeconds * 1000),
      workerId: null,
      leaseExpiresAt: null,
      errorCode: code,
      errorMessage: message,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.aiJobs.id, job.id),
        eq(schema.aiJobs.status, "running"),
        eq(schema.aiJobs.workerId, job.workerId!),
      ),
    );
  return delaySeconds;
}

export async function failAiJob(job: AiJob, code: string, message: string) {
  const db = getDb();
  const now = new Date();
  await db
    .update(schema.aiJobs)
    .set({
      status: "failed",
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

export async function assertJobConfiguration(job: AiJob) {
  const [ai, generation] = await Promise.all([
    getAiSettings(job.userId),
    getGenerationSettings(job.userId),
  ]);
  if (
    ai.provider !== job.provider ||
    ai.model !== job.model ||
    ai.reasoningMode !== job.reasoningMode ||
    generation.language !== job.generationLanguage
  ) {
    throw new Error("ai_configuration_changed");
  }
}

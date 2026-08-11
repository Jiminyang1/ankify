import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { ModelMessage } from "ai";
import type {
  AgentMessageDto,
  AgentNavigation,
  AgentPageContext,
  AgentProposal,
  AgentRunDto,
  AgentSessionDto,
  AgentSessionSnapshotDto,
  AgentStepDto,
} from "@ankify/contracts";
import {
  getDb,
  schema,
  type AgentMessage,
  type AgentRun,
  type AgentSession,
  type AgentStep,
} from "@ankify/db";
import type { AiRuntimeSettings } from "@/server/settings";

const SNAPSHOT_RUN_LIMIT = 50;
const MODEL_RUN_LIMIT = 24;
const STALE_RUN_MS = 240_000;

function interruptedRunUpdate(now: Date) {
  return {
    status: "failed" as const,
    errorCode: "agent_interrupted",
    errorMessage: "The previous response was interrupted.",
    finishedAt: now,
  };
}

function staleRunCondition(userId: string, sessionId: string, now: Date) {
  return and(
    eq(schema.agentRuns.userId, userId),
    eq(schema.agentRuns.sessionId, sessionId),
    eq(schema.agentRuns.status, "running"),
    lt(schema.agentRuns.startedAt, new Date(now.getTime() - STALE_RUN_MS)),
  );
}

export class AgentRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AgentRequestError";
  }
}

export async function listAgentSessions(userId: string) {
  const db = getDb();
  const sessions = await db
    .select()
    .from(schema.agentSessions)
    .where(
      and(
        eq(schema.agentSessions.userId, userId),
        eq(schema.agentSessions.status, "active"),
      ),
    )
    .orderBy(desc(schema.agentSessions.updatedAt));
  return sessions.map(toAgentSessionDto);
}

export async function beginAgentTurn(args: {
  userId: string;
  sessionId: string | null;
  requestId: string;
  message: string;
  context: AgentPageContext;
  settings: AiRuntimeSettings;
}) {
  const db = getDb();
  return db.transaction(async (tx) => {
    if (args.context.problemId) {
      const [problem] = await tx
        .select({ id: schema.problems.id })
        .from(schema.problems)
        .where(
          and(
            eq(schema.problems.id, args.context.problemId),
            eq(schema.problems.userId, args.userId),
          ),
        )
        .limit(1);
      if (!problem) {
        throw new AgentRequestError("problem_not_found", "Problem not found.", 404);
      }
    }

    let session: AgentSession | undefined;
    if (args.sessionId) {
      [session] = await tx
        .select()
        .from(schema.agentSessions)
        .where(
          and(
            eq(schema.agentSessions.id, args.sessionId),
            eq(schema.agentSessions.userId, args.userId),
            eq(schema.agentSessions.status, "active"),
          ),
        )
        .limit(1);
      if (!session) {
        throw new AgentRequestError("session_not_found", "Agent session not found.", 404);
      }
    }

    const [duplicate] = await tx
      .select({ id: schema.agentRuns.id })
      .from(schema.agentRuns)
      .where(
        and(
          eq(schema.agentRuns.userId, args.userId),
          eq(schema.agentRuns.requestId, args.requestId),
        ),
      )
      .limit(1);
    if (duplicate) {
      throw new AgentRequestError("request_already_used", "This Agent request was already sent.", 409);
    }

    const now = new Date();
    if (!session) {
      [session] = await tx
        .insert(schema.agentSessions)
        .values({
          id: nanoid(16),
          userId: args.userId,
          title: makeSessionTitle(args.message),
          createdAt: now,
          updatedAt: now,
        })
        .returning();
    }
    const activeSession = session!;
    await tx
      .update(schema.agentRuns)
      .set(interruptedRunUpdate(now))
      .where(staleRunCondition(args.userId, activeSession.id, now));

    const [activeRun] = await tx
      .select({ id: schema.agentRuns.id })
      .from(schema.agentRuns)
      .where(
        and(
          eq(schema.agentRuns.sessionId, activeSession.id),
          eq(schema.agentRuns.status, "running"),
        ),
      )
      .limit(1);
    if (activeRun) {
      throw new AgentRequestError("agent_busy", "The Study Coach is already responding.", 409);
    }

    const [run] = await tx
      .insert(schema.agentRuns)
      .values({
        id: nanoid(16),
        userId: args.userId,
        sessionId: activeSession.id,
        requestId: args.requestId,
        contextJson: args.context,
        provider: args.settings.provider,
        model: args.settings.model,
        startedAt: now,
      })
      .returning();

    const [message] = await tx
      .insert(schema.agentMessages)
      .values({
        id: nanoid(16),
        userId: args.userId,
        sessionId: activeSession.id,
        runId: run!.id,
        role: "user",
        content: args.message,
        createdAt: now,
      })
      .returning();

    const [updatedSession] = await tx
      .update(schema.agentSessions)
      .set({
        title: activeSession.title ?? makeSessionTitle(args.message),
        updatedAt: now,
      })
      .where(eq(schema.agentSessions.id, activeSession.id))
      .returning();

    return {
      session: toAgentSessionDto(updatedSession!),
      run: toAgentRunDto(run!),
      message: toAgentMessageDto(message!),
    };
  });
}

export async function getAgentSessionSnapshot(
  userId: string,
  sessionId: string,
): Promise<AgentSessionSnapshotDto | null> {
  const db = getDb();
  const [session] = await db
    .select()
    .from(schema.agentSessions)
    .where(
      and(
        eq(schema.agentSessions.id, sessionId),
        eq(schema.agentSessions.userId, userId),
        eq(schema.agentSessions.status, "active"),
      ),
    )
    .limit(1);
  if (!session) return null;

  const now = new Date();
  await db
    .update(schema.agentRuns)
    .set(interruptedRunUpdate(now))
    .where(staleRunCondition(userId, session.id, now));

  const runs = (
    await db
      .select()
      .from(schema.agentRuns)
      .where(
        and(
          eq(schema.agentRuns.userId, userId),
          eq(schema.agentRuns.sessionId, session.id),
        ),
      )
      .orderBy(desc(schema.agentRuns.startedAt))
      .limit(SNAPSHOT_RUN_LIMIT)
  ).reverse();
  const runIds = runs.map((run) => run.id);
  const [messages, steps] = runIds.length
    ? await Promise.all([
        db
          .select()
          .from(schema.agentMessages)
          .where(
            and(
              eq(schema.agentMessages.userId, userId),
              inArray(schema.agentMessages.runId, runIds),
            ),
          )
          .orderBy(asc(schema.agentMessages.createdAt)),
        db
          .select()
          .from(schema.agentSteps)
          .where(
            and(
              eq(schema.agentSteps.userId, userId),
              inArray(schema.agentSteps.runId, runIds),
            ),
          )
          .orderBy(asc(schema.agentSteps.createdAt), asc(schema.agentSteps.sequence)),
      ])
    : [[], []];

  return {
    session: toAgentSessionDto(session),
    messages: messages.map(toAgentMessageDto),
    runs: runs.map(toAgentRunDto),
    steps: steps.map(toAgentStepDto),
  };
}

export async function getAgentModelMessages(userId: string, sessionId: string) {
  const db = getDb();
  const runs = (
    await db
      .select({
        id: schema.agentRuns.id,
        status: schema.agentRuns.status,
        responseMessagesJson: schema.agentRuns.responseMessagesJson,
        startedAt: schema.agentRuns.startedAt,
      })
      .from(schema.agentRuns)
      .where(
        and(
          eq(schema.agentRuns.userId, userId),
          eq(schema.agentRuns.sessionId, sessionId),
        ),
      )
      .orderBy(desc(schema.agentRuns.startedAt))
      .limit(MODEL_RUN_LIMIT)
  ).reverse();
  if (runs.length === 0) return [];

  const userMessages = await db
    .select({ runId: schema.agentMessages.runId, content: schema.agentMessages.content })
    .from(schema.agentMessages)
    .where(
      and(
        eq(schema.agentMessages.userId, userId),
        eq(schema.agentMessages.role, "user"),
        inArray(schema.agentMessages.runId, runs.map((run) => run.id)),
      ),
    );
  const userContentByRun = new Map(userMessages.map((message) => [message.runId, message.content]));

  return runs.flatMap<ModelMessage>((run) => {
    const messages: ModelMessage[] = [
      { role: "user", content: userContentByRun.get(run.id)! },
    ];
    if (run.status === "succeeded") {
      messages.push(...(run.responseMessagesJson as ModelMessage[]));
    }
    return messages;
  });
}

export async function createAgentStep(args: {
  userId: string;
  runId: string;
  sequence: number;
  kind: "read" | "navigation" | "proposal";
  toolName: string;
  status: AgentStep["status"];
  summary: string;
  navigation?: AgentNavigation;
  proposal?: AgentProposal;
}) {
  const db = getDb();
  const [step] = await db
    .insert(schema.agentSteps)
    .values({
      id: nanoid(16),
      userId: args.userId,
      runId: args.runId,
      sequence: args.sequence,
      kind: args.kind,
      toolName: args.toolName,
      status: args.status,
      summary: args.summary,
      navigationJson: args.navigation,
      proposalJson: args.proposal,
    })
    .returning();
  return toAgentStepDto(step!);
}

export async function finishAgentRun(args: {
  userId: string;
  sessionId: string;
  runId: string;
  content: string;
  responseMessages: ModelMessage[];
  inputTokens?: number;
  outputTokens?: number;
}) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const now = new Date();
    const [message] = await tx
      .insert(schema.agentMessages)
      .values({
        id: nanoid(16),
        userId: args.userId,
        sessionId: args.sessionId,
        runId: args.runId,
        role: "assistant",
        content: args.content,
        createdAt: now,
      })
      .returning();
    const [run] = await tx
      .update(schema.agentRuns)
      .set({
        status: "succeeded",
        responseMessagesJson: args.responseMessages,
        inputTokens: args.inputTokens,
        outputTokens: args.outputTokens,
        finishedAt: now,
      })
      .where(
        and(
          eq(schema.agentRuns.id, args.runId),
          eq(schema.agentRuns.userId, args.userId),
          eq(schema.agentRuns.status, "running"),
        ),
      )
      .returning();
    if (!run) throw new Error("agent_run_not_running");
    await tx
      .update(schema.agentSessions)
      .set({ updatedAt: now })
      .where(eq(schema.agentSessions.id, args.sessionId));
    return { message: toAgentMessageDto(message!), run: toAgentRunDto(run) };
  });
}

export async function failAgentRun(args: {
  userId: string;
  runId: string;
  code: string;
  message: string;
}) {
  const db = getDb();
  const [run] = await db
    .update(schema.agentRuns)
    .set({
      status: "failed",
      errorCode: args.code,
      errorMessage: args.message,
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(schema.agentRuns.id, args.runId),
        eq(schema.agentRuns.userId, args.userId),
        eq(schema.agentRuns.status, "running"),
      ),
    )
    .returning();
  if (!run) throw new Error("agent_run_not_running");
  return toAgentRunDto(run);
}

export async function getOwnedAgentStep(userId: string, stepId: string) {
  const db = getDb();
  const [step] = await db
    .select()
    .from(schema.agentSteps)
    .where(and(eq(schema.agentSteps.id, stepId), eq(schema.agentSteps.userId, userId)))
    .limit(1);
  return step ?? null;
}

export async function acceptAgentProposal(userId: string, stepId: string, aiJobId: string) {
  const db = getDb();
  const now = new Date();
  const [step] = await db
    .update(schema.agentSteps)
    .set({ status: "accepted", aiJobId, updatedAt: now })
    .where(
      and(
        eq(schema.agentSteps.id, stepId),
        eq(schema.agentSteps.userId, userId),
        eq(schema.agentSteps.status, "pending"),
      ),
    )
    .returning();
  if (step) return toAgentStepDto(step);

  const current = await getOwnedAgentStep(userId, stepId);
  if (!current || current.status !== "accepted" || current.aiJobId !== aiJobId) {
    throw new AgentRequestError("proposal_not_pending", "This proposal is no longer pending.", 409);
  }
  return toAgentStepDto(current);
}

export async function dismissAgentProposal(userId: string, stepId: string) {
  const db = getDb();
  const [step] = await db
    .update(schema.agentSteps)
    .set({ status: "dismissed", updatedAt: new Date() })
    .where(
      and(
        eq(schema.agentSteps.id, stepId),
        eq(schema.agentSteps.userId, userId),
        eq(schema.agentSteps.status, "pending"),
      ),
    )
    .returning();
  if (!step) {
    throw new AgentRequestError("proposal_not_pending", "This proposal is no longer pending.", 409);
  }
  return toAgentStepDto(step);
}

export function toAgentSessionDto(session: AgentSession): AgentSessionDto {
  return {
    id: session.id,
    title: session.title,
    status: session.status,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}

export function toAgentMessageDto(message: AgentMessage): AgentMessageDto {
  return {
    id: message.id,
    sessionId: message.sessionId,
    runId: message.runId,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
  };
}

export function toAgentRunDto(run: AgentRun): AgentRunDto {
  return {
    id: run.id,
    sessionId: run.sessionId,
    requestId: run.requestId,
    status: run.status,
    context: run.contextJson,
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

export function toAgentStepDto(step: AgentStep): AgentStepDto {
  return {
    id: step.id,
    runId: step.runId,
    sequence: step.sequence,
    kind: step.kind,
    toolName: step.toolName,
    status: step.status,
    summary: step.summary,
    navigation: step.navigationJson,
    proposal: step.proposalJson,
    aiJobId: step.aiJobId,
    createdAt: step.createdAt.toISOString(),
    updatedAt: step.updatedAt.toISOString(),
  };
}

function makeSessionTitle(message: string) {
  const title = message.replace(/\s+/g, " ").trim();
  return title.length <= 48 ? title : `${title.slice(0, 47)}…`;
}

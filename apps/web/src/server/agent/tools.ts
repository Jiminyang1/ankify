import { and, asc, desc, eq, isNull, like } from "drizzle-orm";
import { tool } from "ai";
import { z } from "zod";
import type { AgentNavigation, AgentProposal, AgentStepDto } from "@ankify/contracts";
import { getDb, schema } from "@ankify/db";
import { getCurrentQuizSession } from "@/server/ai-generation/quiz";
import { dueProblemCondition } from "@/server/due-problems";
import { createAgentStep } from "./store";
import { toAgentSafeQuizState } from "./quiz-context";

type AgentToolContext = {
  userId: string;
  problemId: string | null;
  runId: string;
  emitStep: (step: AgentStepDto) => void;
};

export function createStudyCoachTools(context: AgentToolContext) {
  let nextSequence = 1;
  const problemIdInput = z
    .string()
    .min(1)
    .max(64)
    .describe("Opaque saved problem id returned by search_problems; never pass a title")
    .optional();

  const record = async (args: {
    kind: "read" | "navigation" | "proposal";
    toolName: string;
    status: "completed" | "pending" | "failed";
    summary: string;
    navigation?: AgentNavigation;
    proposal?: AgentProposal;
  }) => {
    const sequence = nextSequence++;
    const step = await createAgentStep({ ...context, ...args, sequence });
    context.emitStep(step);
    return step;
  };

  const resolveProblem = async (requestedId?: string) => {
    const problemId = requestedId ?? context.problemId;
    if (!problemId) throw new Error("problem_context_required");
    const [problem] = await getDb()
      .select({ id: schema.problems.id, title: schema.problems.title })
      .from(schema.problems)
      .where(
        and(
          eq(schema.problems.id, problemId),
          eq(schema.problems.userId, context.userId),
        ),
      )
      .limit(1);
    if (!problem) throw new Error("problem_not_found");
    return problem;
  };

  return {
    get_review_queue: tool({
      description:
        "Load the user's currently due problems and memory state. Use this for review planning and prioritization.",
      inputSchema: z.object({}),
      execute: async () => {
        const problems = await getDb()
          .select({
            id: schema.problems.id,
            title: schema.problems.title,
            difficulty: schema.problems.difficulty,
            tags: schema.problems.topicTags,
            fsrsState: schema.problems.fsrsState,
            fsrsDue: schema.problems.fsrsDue,
            fsrsStability: schema.problems.fsrsStability,
            fsrsDifficulty: schema.problems.fsrsDifficulty,
            fsrsReps: schema.problems.fsrsReps,
            fsrsLapses: schema.problems.fsrsLapses,
          })
          .from(schema.problems)
          .where(dueProblemCondition(context.userId))
          .orderBy(asc(schema.problems.fsrsDue))
          .limit(20);
        await record({
          kind: "read",
          toolName: "get_review_queue",
          status: "completed",
          summary: `Loaded ${problems.length} due problem${problems.length === 1 ? "" : "s"}`,
        });
        return problems.map((problem) => ({
          ...problem,
          fsrsDue: problem.fsrsDue?.toISOString() ?? null,
        }));
      },
    }),

    search_problems: tool({
      description:
        "Find the user's saved problems by title. Use this when the user refers to a problem that is not the current page.",
      inputSchema: z.object({
        query: z.string().trim().max(200).default(""),
      }),
      execute: async ({ query }) => {
        const problems = await getDb()
          .select({
            id: schema.problems.id,
            title: schema.problems.title,
            difficulty: schema.problems.difficulty,
            tags: schema.problems.topicTags,
            fsrsState: schema.problems.fsrsState,
            fsrsDue: schema.problems.fsrsDue,
          })
          .from(schema.problems)
          .where(
            and(
              eq(schema.problems.userId, context.userId),
              isNull(schema.problems.archivedAt),
              query ? like(schema.problems.title, `%${query}%`) : undefined,
            ),
          )
          .orderBy(asc(schema.problems.title))
          .limit(20);
        await record({
          kind: "read",
          toolName: "search_problems",
          status: "completed",
          summary: `Found ${problems.length} problem${problems.length === 1 ? "" : "s"}`,
        });
        return problems.map((problem) => ({
          ...problem,
          fsrsDue: problem.fsrsDue?.toISOString() ?? null,
        }));
      },
    }),

    open_problem: tool({
      description:
        "Open a saved problem in the web app after the user explicitly agrees to open, start, or review it. Use review to begin studying and problem to view its details.",
      inputSchema: z.object({
        problemId: problemIdInput,
        destination: z.enum(["review", "problem"]).default("review"),
      }),
      execute: async ({ problemId: requestedId, destination }) => {
        const target = await resolveProblem(requestedId);
        const navigation: AgentNavigation = {
          destination,
          problemId: target.id,
        };
        await record({
          kind: "navigation",
          toolName: "open_problem",
          status: "completed",
          summary: `Open ${target.title} in ${destination}`,
          navigation,
        });
        return { ...navigation, title: target.title };
      },
    }),

    get_problem_context: tool({
      description:
        "Load a problem statement, study notes, tags, and FSRS memory state. Omit problemId to use the current problem.",
      inputSchema: z.object({ problemId: problemIdInput }),
      execute: async ({ problemId: requestedId }) => {
        const target = await resolveProblem(requestedId);
        const db = getDb();
        const [problem] = await db
          .select({
            id: schema.problems.id,
            title: schema.problems.title,
            slug: schema.problems.leetcodeSlug,
            difficulty: schema.problems.difficulty,
            description: schema.problems.descriptionMd,
            tags: schema.problems.topicTags,
            notes: schema.problems.notes,
            fsrsState: schema.problems.fsrsState,
            fsrsDue: schema.problems.fsrsDue,
            fsrsStability: schema.problems.fsrsStability,
            fsrsDifficulty: schema.problems.fsrsDifficulty,
            fsrsReps: schema.problems.fsrsReps,
            fsrsLapses: schema.problems.fsrsLapses,
          })
          .from(schema.problems)
          .where(
            and(
              eq(schema.problems.id, target.id),
              eq(schema.problems.userId, context.userId),
            ),
          )
          .limit(1);
        if (!problem) throw new Error("problem_not_found");
        await record({
          kind: "read",
          toolName: "get_problem_context",
          status: "completed",
          summary: `Loaded context for ${problem.title}`,
        });
        return {
          ...problem,
          description: limitText(problem.description, 60_000),
          notes: limitText(problem.notes, 30_000),
          fsrsDue: problem.fsrsDue?.toISOString() ?? null,
        };
      },
    }),

    get_submissions: tool({
      description:
        "Load recent submitted code and failure details for a problem. Omit problemId to use the current problem.",
      inputSchema: z.object({
        problemId: problemIdInput,
        limit: z.number().int().min(1).max(5).default(3),
      }),
      execute: async ({ problemId: requestedId, limit }) => {
        const target = await resolveProblem(requestedId);
        const db = getDb();
        const submissions = await db
          .select({
            id: schema.submissions.id,
            language: schema.submissions.language,
            code: schema.submissions.code,
            status: schema.submissions.status,
            runtimeMs: schema.submissions.runtimeMs,
            memoryKb: schema.submissions.memoryKb,
            failedTestcase: schema.submissions.failedTestcase,
            expectedOutput: schema.submissions.expectedOutput,
            actualOutput: schema.submissions.actualOutput,
            errorMessage: schema.submissions.errorMessage,
            submittedAt: schema.submissions.submittedAt,
          })
          .from(schema.submissions)
          .where(
            and(
              eq(schema.submissions.problemId, target.id),
              eq(schema.submissions.userId, context.userId),
            ),
          )
          .orderBy(desc(schema.submissions.submittedAt))
          .limit(limit);
        await record({
          kind: "read",
          toolName: "get_submissions",
          status: "completed",
          summary: `Loaded ${submissions.length} recent submission${submissions.length === 1 ? "" : "s"}`,
        });
        return submissions.map((submission) => ({
          ...submission,
          code: limitText(submission.code, 30_000),
          submittedAt: submission.submittedAt.toISOString(),
        }));
      },
    }),

    get_cards: tool({
      description:
        "Load a problem's ready and candidate flashcards. Omit problemId to use the current problem.",
      inputSchema: z.object({ problemId: problemIdInput }),
      execute: async ({ problemId: requestedId }) => {
        const target = await resolveProblem(requestedId);
        const db = getDb();
        const cards = await db
          .select({
            id: schema.cards.id,
            status: schema.cards.aiStatus,
            question: schema.cards.question,
            answer: schema.cards.answer,
            version: schema.cards.version,
          })
          .from(schema.cards)
          .where(
            and(
              eq(schema.cards.problemId, target.id),
              eq(schema.cards.userId, context.userId),
            ),
          )
          .orderBy(desc(schema.cards.createdAt))
          .limit(20);
        await record({
          kind: "read",
          toolName: "get_cards",
          status: "completed",
          summary: `Loaded ${cards.length} card${cards.length === 1 ? "" : "s"}`,
        });
        return cards.map((card) => ({
          ...card,
          question: limitText(card.question, 4_000),
          answer: limitText(card.answer, 8_000),
        }));
      },
    }),

    get_quiz_state: tool({
      description:
        "Load a problem's quiz state. Omit problemId to use the current problem. Unanswered content is withheld.",
      inputSchema: z.object({ problemId: problemIdInput }),
      execute: async ({ problemId: requestedId }) => {
        const target = await resolveProblem(requestedId);
        const session = await getCurrentQuizSession(context.userId, target.id);
        await record({
          kind: "read",
          toolName: "get_quiz_state",
          status: "completed",
          summary: session ? `Loaded ${session.status} quiz state` : "No current quiz",
        });
        if (!session) return { session: null };
        return { session: toAgentSafeQuizState(session) };
      },
    }),

    propose_card_draft: tool({
      description:
        "Propose generating one AI card candidate. Call only when the user explicitly asks to create or generate a card. This never writes a card until the user confirms the proposal.",
      inputSchema: z.object({
        problemId: problemIdInput,
        reason: z.string().min(1).max(500),
      }),
      execute: async ({ problemId: requestedId, reason }) => {
        const target = await resolveProblem(requestedId);
        const proposal: AgentProposal = {
          action: "card_generate",
          requestId: crypto.randomUUID(),
          problemId: target.id,
          reason,
        };
        const step = await record({
          kind: "proposal",
          toolName: "propose_card_draft",
          status: "pending",
          summary: reason,
          proposal,
        });
        return {
          proposalId: step.id,
          action: proposal.action,
          requiresUserConfirmation: true,
        };
      },
    }),

    propose_quiz_generation: tool({
      description:
        "Propose generating a quiz batch. Call only when the user explicitly asks. Use generate when none exists, regenerate to replace the current batch, and next_batch only after a completed quiz. Nothing changes until the user confirms.",
      inputSchema: z.object({
        problemId: problemIdInput,
        action: z.enum(["generate", "regenerate", "next_batch"]),
        reason: z.string().min(1).max(500),
      }),
      execute: async ({ problemId: requestedId, action, reason }) => {
        const target = await resolveProblem(requestedId);
        const current = await getCurrentQuizSession(context.userId, target.id);
        if (action === "generate" && current) {
          await record({
            kind: "read",
            toolName: "propose_quiz_generation",
            status: "completed",
            summary: `A ${current.status} quiz already exists`,
          });
          return {
            proposalCreated: false,
            currentSessionId: current.id,
            currentStatus: current.status,
          };
        }
        if (action === "regenerate" && !current) throw new Error("quiz_not_found");
        if (action === "next_batch" && current?.status !== "completed") {
          throw new Error("quiz_session_not_completed");
        }
        const mappedAction = {
          generate: "quiz_generate",
          regenerate: "quiz_regenerate",
          next_batch: "quiz_next_batch",
        }[action] as "quiz_generate" | "quiz_regenerate" | "quiz_next_batch";
        const proposal: AgentProposal = {
          action: mappedAction,
          requestId: crypto.randomUUID(),
          problemId: target.id,
          expectedQuizSessionId: current?.id ?? null,
          reason,
        };
        const step = await record({
          kind: "proposal",
          toolName: "propose_quiz_generation",
          status: "pending",
          summary: reason,
          proposal,
        });
        return {
          proposalId: step.id,
          action: proposal.action,
          requiresUserConfirmation: true,
        };
      },
    }),
  };
}

function limitText(value: string | null, maxLength: number) {
  if (value === null || value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n\n[truncated]`;
}

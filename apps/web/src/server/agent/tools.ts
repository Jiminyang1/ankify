import { and, asc, desc, eq, isNull, like } from "drizzle-orm";
import { tool } from "ai";
import { z } from "zod";
import {
  docEditSchema,
  docEditTarget,
  type AgentNavigation,
  type AgentProposal,
  type AgentStepDto,
  type DocEdit,
} from "@ankify/contracts";
import { WEAKNESS_CATEGORIES, leetcodeTagName } from "@ankify/core";
import { getDb, schema } from "@ankify/db";
import { getCurrentQuizSession } from "@/server/ai-generation/quiz";
import { dueProblemCondition } from "@/server/due-problems";
import { firstTalkInstruction, gradeTalkTarget, startPractice, type PracticeAi } from "@/server/practice";
import { loadProblemDocs, previewProblemDocEdit } from "@/server/problem-docs";
import { listProblemWeaknesses, loadWeaknessProfile, recordWeakness } from "@/server/weaknesses";
import { loadProfile, type PlanItem } from "@/server/profile";
import { getReviewQueueStatus } from "@/server/review-queue";
import { docEditInput } from "./doc-edit-input";
import { createAgentStep } from "./store";
import { toAgentSafeQuizState } from "./quiz-context";
import { relativeTimeLabel } from "./time-labels";

type AgentToolContext = {
  userId: string;
  problemId: string | null;
  runId: string;
  emitStep: (step: AgentStepDto) => void;
  /** Writes a problem's Solutions doc when practice starts on it. */
  ai?: PracticeAi;
};

/** Code-enforced cap; the prompt asks for one per ordinary reply. */
const MAX_DOC_PROPOSALS_PER_RUN = 3;
/** Code-enforced cap on new weaknesses per reply. */
const MAX_WEAKNESSES_PER_RUN = 3;

export function createStudyCoachTools(context: AgentToolContext) {
  let nextSequence = 1;
  let docProposals = 0;
  let weaknessesRecorded = 0;
  const problemIdInput = z
    .string()
    .min(1)
    .max(64)
    .describe("Opaque saved problem id returned by search_problems; never pass a title")
    .optional();

  const record = async (args: {
    kind: "read" | "navigation" | "proposal" | "practice" | "weakness";
    toolName: string;
    status: "completed" | "pending" | "failed";
    summary: string;
    navigation?: AgentNavigation;
    proposal?: AgentProposal;
    practiceSessionId?: string;
    weaknessId?: string;
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

  const tools = {
    get_review_queue: tool({
      description:
        "Load only problems currently eligible for review: already due at asOf or never scheduled. Future-due problems are not returned. Also returns the user's authoritative daily queue stats. Use this for review planning and prioritization; never invent additional time buckets.",
      inputSchema: z.object({}),
      execute: async () => {
        const now = new Date();
        const [problems, stats] = await Promise.all([
          getDb()
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
            .where(dueProblemCondition(context.userId, now))
            .orderBy(asc(schema.problems.fsrsDue))
            .limit(20),
          getReviewQueueStatus(context.userId),
        ]);
        await record({
          kind: "read",
          toolName: "get_review_queue",
          status: "completed",
          summary: `Loaded ${problems.length} currently eligible problem${problems.length === 1 ? "" : "s"}`,
        });
        return {
          asOf: now.toISOString(),
          scope: "Every listed problem is eligible now: fsrsDue is at or before asOf, or null for never scheduled. No future-due problems are included.",
          stats,
          returnedCount: problems.length,
          truncated: stats.totalDue > problems.length,
          problems: problems.map((problem) => ({
            ...problem,
            tags: problem.tags.map(leetcodeTagName),
            fsrsDue: problem.fsrsDue?.toISOString() ?? null,
            fsrsDueRelative: problem.fsrsDue ? relativeTimeLabel(problem.fsrsDue, now) : null,
          })),
        };
      },
    }),

    get_study_plan: tool({
      description:
        "Load the user's current study plan from their profile roadmap: every pattern group in learning order with its status counts, the next not-started problems in each group, problems in the user's reviews they have forgotten before, and the LeetCode topic plan that goes deeper on a pattern. Use this when the user asks what to solve, learn, or practice next, or how their plan is going.",
      inputSchema: z.object({}),
      execute: async () => {
        const profile = await loadProfile(context.userId);
        const label: Record<PlanItem["status"], string> = {
          todo: "not started",
          solved: "solved, not reviewing",
          remembered: "remembered",
          due: "due for review",
        };
        const counts = (value: Record<PlanItem["status"], number>) =>
          Object.fromEntries(Object.entries(value).map(([status, count]) => [label[status as PlanItem["status"]], count]));
        const newProblem = (item: PlanItem) => ({
          title: item.title,
          difficulty: item.difficulty,
          leetcodeUrl: `https://leetcode.com/problems/${item.slug}/`,
        });
        await record({
          kind: "read",
          toolName: "get_study_plan",
          status: "completed",
          summary: `Loaded the ${profile.plan.name} plan`,
        });
        return {
          plan: profile.plan.name,
          totalProblems: profile.total,
          counts: counts(profile.counts),
          statusMeaning:
            "not started = never solved on LeetCode; solved, not reviewing = solved on LeetCode but not in ankify reviews; remembered = in reviews and not due yet; due for review = in reviews and due now. Use these words with the user.",
          leetcodeHistorySynced: profile.solvedSync != null,
          nextInPlanOrder: profile.next ? newProblem(profile.next) : null,
          groups: profile.groups.map((group, index) => ({
            order: index + 1,
            name: group.name,
            counts: counts(group.counts),
            nextNotStarted: group.items.filter((item) => item.status === "todo").slice(0, 5).map(newProblem),
            forgottenBefore: group.items
              .filter((item) => item.problemId && item.lapses > 0)
              .sort((a, b) => b.lapses - a.lapses)
              .slice(0, 3)
              .map((item) => ({
                problemId: item.problemId,
                title: item.title,
                timesForgotten: item.lapses,
                status: label[item.status],
              })),
            deeperPlan: group.deepDive ? `${group.deepDive.name} (${group.deepDive.total} problems)` : null,
          })),
        };
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
          tags: problem.tags.map(leetcodeTagName),
          fsrsDue: problem.fsrsDue?.toISOString() ?? null,
          fsrsDueRelative: problem.fsrsDue ? relativeTimeLabel(problem.fsrsDue) : null,
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
        "Load a problem statement, study notes, tags, and FSRS memory state when those facts are needed for the user's latest request. Omit problemId to use the current problem. Reuse a recent result instead of reloading it.",
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
          tags: problem.tags.map(leetcodeTagName),
          description: limitText(problem.description, 60_000),
          notes: limitText(problem.notes, 30_000),
          fsrsDue: problem.fsrsDue?.toISOString() ?? null,
          fsrsDueRelative: problem.fsrsDue ? relativeTimeLabel(problem.fsrsDue) : null,
        };
      },
    }),

    get_submissions: tool({
      description:
        "Load recent submitted code and failure details only when the user asks about their code, implementation, failure, or when code evidence is necessary to diagnose a stated mistake. Never call it just because the Submissions panel is open or to personalize a general explanation. Omit problemId to use the current problem.",
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
          submittedAgo: relativeTimeLabel(submission.submittedAt),
        }));
      },
    }),

    get_quiz_state: tool({
      description:
        "Load a problem's quiz state only when the user asks about quiz progress, an answered quiz result, or requests a quiz action that depends on current state. Never call it merely because the Quiz panel is open and never redirect unrelated teaching to Quiz. Omit problemId to use the current problem. Unanswered content is withheld.",
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

    get_problem_docs: tool({
      description:
        "Load the problem's two docs: Notes (the user's understanding, in ## sections such as Approach, Key insight, Pitfalls, Complexity, My attempts) and Cards (each ## heading is a recall prompt, the text under it the answer, each card has a key). Call before proposing a doc edit, or when what the user already wrote down matters.",
      inputSchema: z.object({ problemId: problemIdInput }),
      execute: async ({ problemId: requestedId }) => {
        const target = await resolveProblem(requestedId);
        const docs = await loadProblemDocs(context.userId, target.id);
        if (!docs) throw new Error("problem_not_found");
        await record({
          kind: "read",
          toolName: "get_problem_docs",
          status: "completed",
          summary: `Read Notes and Cards for ${target.title}`,
        });
        return {
          notes: docs.notes.markdown || null,
          notesSections: docs.notes.sections,
          cards: docs.cards.cards,
          cardIssues: docs.cards.issues,
        };
      },
    }),

    get_weaknesses: tool({
      description:
        "Load the user's recorded weak spots: this problem's (active and resolved, each with category, detail, evidence, and how often it happened) and their profile across problems (categories ranked by active weaknesses). Also lists the categories you can record into. Call before recording, and whenever their past mistakes matter.",
      inputSchema: z.object({ problemId: problemIdInput }),
      execute: async ({ problemId: requestedId }) => {
        const problemId = requestedId ?? context.problemId;
        const [problemWeaknesses, profile] = await Promise.all([
          problemId ? listProblemWeaknesses(context.userId, (await resolveProblem(problemId)).id) : Promise.resolve([]),
          loadWeaknessProfile(context.userId),
        ]);
        await record({
          kind: "read",
          toolName: "get_weaknesses",
          status: "completed",
          summary: `Read ${problemWeaknesses.length} weak spot${problemWeaknesses.length === 1 ? "" : "s"} on this problem`,
        });
        return {
          thisProblem: problemWeaknesses.map((weakness) => ({
            id: weakness.id,
            category: weakness.category,
            detail: weakness.detail,
            status: weakness.status,
            timesSeen: weakness.hitCount,
            lastSeen: relativeTimeLabel(new Date(weakness.lastSeenAt)),
          })),
          profile: profile.categories.slice(0, 6).map((entry) => ({
            category: entry.category,
            active: entry.active,
            resolved: entry.resolved,
            timesSeen: entry.hits,
            problems: entry.problems.map((problem) => problem.title),
          })),
          categories: [
            ...WEAKNESS_CATEGORIES.map((category) => ({
              key: category.key,
              name: category.name.en,
              description: category.description,
            })),
            ...profile.customCategories.map((category) => ({
              key: category.key,
              name: category.name,
              description: category.description,
            })),
          ],
        };
      },
    }),

    record_weakness: tool({
      description:
        "Record one specific mistake the user makes on this problem, with its category and evidence. Recorded at once (the user can remove it). Use when you've diagnosed a mistake from a submission, a practice answer, or the conversation. A repeat of an active weak spot updates it instead of adding a new one.",
      inputSchema: z.object({
        problemId: problemIdInput,
        category: z.string().max(40).describe("A category key from get_weaknesses"),
        detail: z
          .string()
          .max(300)
          .describe("The specific mistake in one sentence, concrete to this problem, e.g. 'dp starts at 0, so amount 0 returns the wrong count'"),
        submissionIds: z.array(z.string().max(64)).max(5).optional().describe("Submissions showing it (ids from get_submissions)"),
        practiceSessionIds: z.array(z.string().max(64)).max(3).optional(),
      }),
      execute: async ({ problemId: requestedId, category, detail, submissionIds, practiceSessionIds }) => {
        if (weaknessesRecorded >= MAX_WEAKNESSES_PER_RUN) {
          return { recorded: false, error: "too_many_this_turn" };
        }
        const target = await resolveProblem(requestedId);
        const result = await recordWeakness(context.userId, {
          problemId: target.id,
          category: category.trim(),
          detail,
          evidence: [
            ...(submissionIds ?? []).filter(Boolean).map((ref) => ({ kind: "submission" as const, ref })),
            ...(practiceSessionIds ?? []).filter(Boolean).map((ref) => ({ kind: "practice" as const, ref })),
          ],
          runId: context.runId,
        });
        if (!result.ok) return { recorded: false, error: result.error };
        weaknessesRecorded += 1;
        await record({
          kind: "weakness",
          toolName: "record_weakness",
          status: "completed",
          summary: result.weakness.detail,
          weaknessId: result.weakness.id,
        });
        return { recorded: true, merged: result.merged, timesSeen: result.weakness.hitCount };
      },
    }),

    propose_weakness_category: tool({
      description:
        "Propose a new weakness category when none of the existing ones fits a mistake. It's added only if the user approves; until then, don't record into it.",
      inputSchema: z.object({
        key: z.string().regex(/^[a-z][a-z0-9_]{2,39}$/).describe("snake_case key"),
        name: z.string().min(1).max(60),
        description: z.string().min(1).max(200),
        reason: z.string().min(1).max(500),
      }),
      execute: async ({ key, name, description, reason }) => {
        const proposal: AgentProposal = { action: "weakness_category", key, name, description, reason };
        const step = await record({
          kind: "proposal",
          toolName: "propose_weakness_category",
          status: "pending",
          summary: `New category: ${name}`,
          proposal,
        });
        return { proposalId: step.id, requiresUserConfirmation: true };
      },
    }),

    start_practice: tool({
      description:
        "Start a talk-through practice session on a saved problem. The server picks the questions (how they'd solve it and its cost, then this problem's weak spots) and checks each answer; you get an instruction for every reply and only phrase it. Call when the user asks to practice, review, or be quizzed.",
      inputSchema: z.object({ problemId: problemIdInput }),
      execute: async ({ problemId: requestedId }) => {
        const target = await resolveProblem(requestedId);
        const result = await startPractice(context.userId, target.id, { agentRunId: context.runId, ai: context.ai });
        if (!result.ok) return { started: false, error: result.error, message: result.message ?? null };
        await record({
          kind: "practice",
          toolName: "start_practice",
          status: "completed",
          summary: `Practice on ${target.title}`,
          practiceSessionId: result.session.id,
        });
        return {
          started: true,
          targets: result.session.targets.map(({ id, kind, category, label, grade }) => ({ id, kind, category, label, graded: grade?.grade ?? null })),
          instruction: firstTalkInstruction(result.session),
        };
      },
    }),

    grade_answer: tool({
      description:
        "Only when runtimeContext.practiceActive.instruction says the automatic check isn't available for a question: grade it once it's settled. correct: complete and right without help; partial: needed a narrower question, or still partly right; missed: still wrong, or they gave up. The reason is one sentence. The last grade completes the session and returns the score and suggested rating.",
      inputSchema: z.object({
        targetId: z.string().max(80).describe("The target id from runtimeContext.practiceActive"),
        grade: z.enum(["correct", "partial", "missed"]),
        reason: z.string().min(1).max(300),
      }),
      execute: async ({ targetId, grade, reason }) => {
        if (!context.problemId) return { graded: false, error: "no_active_practice" };
        const result = await gradeTalkTarget(context.userId, context.problemId, targetId, { grade, reason });
        if (!result.ok) {
          return {
            graded: false,
            error: result.error,
            ...(result.error === "judged_target"
              ? { next: "This question is checked automatically; follow runtimeContext.practiceActive.instruction instead." }
              : {}),
          };
        }
        const remaining = result.session.targets.filter((target) => !target.grade);
        const recorded = result.session.targets.find((target) => target.id === targetId)?.grade?.grade ?? grade;
        await record({
          kind: "read",
          toolName: "grade_answer",
          status: "completed",
          summary: `${recorded}: ${reason}`,
        });
        return {
          graded: true,
          recordedGrade: recorded,
          completed: result.session.status === "completed",
          next: firstTalkInstruction(result.session),
          remaining: remaining.map(({ id, kind, category, label }) => ({ id, kind, category, label })),
          ...(result.session.status === "completed"
            ? {
                score: result.session.score,
                suggestedRating: ["Again", "Hard", "Good", "Easy"][(result.session.suggestedRating ?? 3) - 1],
              }
            : {}),
        };
      },
    }),

    propose_doc_edit: tool({
      description:
        "Propose one edit to the problem's Notes or Cards doc. Nothing changes until the user approves it. Ops: append_section / replace_section (Notes: section + markdown); add_card (Cards: prompt + answer); update_card (Cards: key + new prompt and/or answer); remove_card (Cards: key). Call get_problem_docs first so you don't duplicate what's there.",
      inputSchema: z.object({
        problemId: problemIdInput,
        op: z.enum(["append_section", "replace_section", "add_card", "update_card", "remove_card"]),
        section: z.string().max(60).optional().describe("Notes section heading, e.g. Pitfalls"),
        markdown: z.string().max(4_000).optional().describe("Notes content to append or replace with"),
        prompt: z.string().max(300).optional().describe("Card prompt: one question, one line"),
        answer: z.string().max(2_000).optional().describe("Card answer: short, at most a few lines"),
        key: z.string().max(16).optional().describe("Existing card key from get_problem_docs"),
        reason: z.string().min(1).max(500).describe("Why this edit helps, in one sentence"),
      }),
      execute: async ({ problemId: requestedId, op, section, markdown, prompt, answer, key, reason }) => {
        if (docProposals >= MAX_DOC_PROPOSALS_PER_RUN) {
          return { proposalCreated: false, error: "too_many_proposals_this_turn" };
        }
        const target = await resolveProblem(requestedId);
        const parsed = docEditSchema.safeParse(
          docEditInput(op, { section, markdown, prompt, answer, key }),
        );
        if (!parsed.success) {
          return { proposalCreated: false, error: "invalid_edit", issues: parsed.error.issues.map((i) => i.message) };
        }
        const edit = parsed.data;
        const preview = await previewProblemDocEdit(context.userId, target.id, edit);
        if (!preview.ok) return { proposalCreated: false, error: preview.error };
        const proposal: AgentProposal = {
          action: "doc_edit",
          problemId: target.id,
          edit,
          baseVersion: preview.baseVersion,
          reason,
        };
        docProposals += 1;
        const step = await record({
          kind: "proposal",
          toolName: "propose_doc_edit",
          status: "pending",
          summary: docEditSummary(edit),
          proposal,
        });
        return {
          proposalId: step.id,
          target: docEditTarget(edit),
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
  return { tools, recordStep: record };
}

function limitText(value: string | null, maxLength: number) {
  if (value === null || value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n\n[truncated]`;
}

/** One line for the proposal card: what will change if the user approves. */
function docEditSummary(edit: DocEdit): string {
  switch (edit.op) {
    case "append_section":
      return `Add to Notes, ${edit.section}`;
    case "replace_section":
      return `Rewrite Notes, ${edit.section}`;
    case "add_card":
      return "Add a card";
    case "update_card":
      return "Edit a card";
    case "remove_card":
      return "Remove a card";
  }
}

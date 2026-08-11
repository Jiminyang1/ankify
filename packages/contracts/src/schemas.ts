import { z } from "zod";

export const difficultyEnum = z.enum(["Easy", "Medium", "Hard"]);

export const submissionStatusEnum = z.enum([
  "Accepted",
  "Wrong Answer",
  "Time Limit Exceeded",
  "Memory Limit Exceeded",
  "Runtime Error",
  "Compile Error",
  "Other",
]);

export const aiProviderEnum = z.enum(["anthropic", "openai", "deepseek"]);
export const aiReasoningModeEnum = z.enum(["fast", "thinking"]);
export const cardAiStatusEnum = z.enum(["candidate", "failed", "ready"]);
export const quizSessionStatusEnum = z.enum(["active", "completed", "archived"]);
export const quizItemSourceEnum = z.enum(["statement", "submission", "notes", "card"]);
export const quizItemScopeEnum = z.enum([
  "approach",
  "invariant",
  "edge_case",
  "complexity",
  "implementation",
  "mistake_review",
]);
export const aiJobStatusEnum = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "superseded",
]);
export const aiJobActionEnum = z.enum([
  "card_generate",
  "card_followup",
  "quiz_generate",
  "quiz_regenerate",
  "quiz_next_batch",
]);

export const agentPageEnum = z.enum([
  "today",
  "review",
  "problems",
  "problem",
  "analysis",
  "settings",
  "extension",
]);
export const agentPanelEnum = z.enum(["quiz", "cards", "submissions", "notes", "overview"]);
export const agentRunStatusEnum = z.enum(["running", "succeeded", "failed"]);
export const agentStepStatusEnum = z.enum([
  "completed",
  "pending",
  "accepted",
  "dismissed",
  "failed",
]);

export const agentPageContextSchema = z
  .object({
    page: agentPageEnum,
    activePanel: agentPanelEnum,
    problemId: z.string().min(1).max(64).nullable(),
  })
  .strict();
export type AgentPageContext = z.infer<typeof agentPageContextSchema>;

export const agentTurnRequestSchema = z
  .object({
    sessionId: z.string().min(1).max(64).nullable(),
    requestId: z.string().uuid(),
    message: z.string().trim().min(1).max(12_000),
    context: agentPageContextSchema,
  })
  .strict();
export type AgentTurnRequestInput = z.infer<typeof agentTurnRequestSchema>;

export const agentProposalSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("card_generate"),
    requestId: z.string().uuid(),
    problemId: z.string().min(1).max(64),
    reason: z.string().min(1).max(500),
  }),
  z.object({
    action: z.enum(["quiz_generate", "quiz_regenerate", "quiz_next_batch"]),
    requestId: z.string().uuid(),
    problemId: z.string().min(1).max(64),
    expectedQuizSessionId: z.string().min(1).max(64).nullable(),
    reason: z.string().min(1).max(500),
  }),
]);
export type AgentProposal = z.infer<typeof agentProposalSchema>;

export const agentNavigationSchema = z
  .object({
    destination: z.enum(["review", "problem"]),
    problemId: z.string().min(1).max(64),
  })
  .strict();
export type AgentNavigation = z.infer<typeof agentNavigationSchema>;

export const captureSubmissionSchema = z.object({
  leetcodeSubmissionId: z.string().max(64).optional(),
  language: z.string().max(64),
  code: z.string().max(100_000),
  status: submissionStatusEnum,
  runtimeMs: z.number().int().optional(),
  memoryKb: z.number().int().optional(),
  failedTestcase: z.string().max(20_000).optional(),
  expectedOutput: z.string().max(20_000).optional(),
  actualOutput: z.string().max(20_000).optional(),
  errorMessage: z.string().max(10_000).optional(),
  submittedAt: z.string().datetime().optional(),
});
export type CaptureSubmissionInput = z.infer<typeof captureSubmissionSchema>;

/* Payload sent by the Chrome extension to add or update a problem. */
export const captureProblemSchema = z.object({
  leetcodeSlug: z.string().min(1).max(256),
  leetcodeId: z.number().int().optional(),
  title: z.string().min(1).max(512),
  difficulty: difficultyEnum,
  url: z.string().url().max(2048),
  descriptionMd: z.string().max(200_000).optional(),
  topicTags: z.array(z.string().max(64)).max(64).default([]),
  similarSlugs: z.array(z.string().max(256)).max(64).default([]),
  notes: z.string().max(50_000).optional(),
  submissions: z.array(captureSubmissionSchema).max(20).default([]),
});
export type CaptureProblemInput = z.infer<typeof captureProblemSchema>;

/** A flash card: question (front) and answer (back). */
export const cardDraftSchema = z.object({
  question: z.string().min(1).max(5_000),
  answer: z.string().min(1).max(20_000),
});
export type CardDraft = z.infer<typeof cardDraftSchema>;

/** Storage / API shape for a quiz item — uses `answerIndex` so the rest of
 *  the app can index `choices[answerIndex]` cheaply. */
export const quizItemSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1).max(4_000),
  choices: z.array(z.string().min(1).max(2_000)).length(4),
  answerIndex: z.number().int().min(0).max(3),
  explanation: z.string().min(1).max(8_000),
  source: quizItemSourceEnum,
  scope: quizItemScopeEnum,
});
export type QuizItem = z.infer<typeof quizItemSchema>;
export type QuizItemScope = z.infer<typeof quizItemScopeEnum>;

export const quizAnswerSchema = z.object({
  itemId: z.string().min(1),
  selectedIndex: z.number().int().min(0).max(3),
  correct: z.boolean(),
  answeredAt: z.string().datetime(),
});
export type QuizAnswer = z.infer<typeof quizAnswerSchema>;

/** AI-generation contract for a single quiz item. Differs from the storage
 *  shape on purpose: identifies the correct option as literal text rather
 *  than an integer index — eliminates the off-by-one errors that plagued the
 *  index-based schema. The server maps `correctAnswer` → `answerIndex` via
 *  `choices.indexOf` before persisting.
 *
 *  No internal "reasoning" field: when DeepSeek thinking mode is on the model
 *  already CoTs via the separate `reasoning_content` response field (which we
 *  discard); when thinking is off the model goes directly to the answer. A
 *  schema-level reasoning field would just bill double for content nobody
 *  reads. */
export const quizDraftItemSchema = z
  .object({
    question: z.string().min(1).max(4_000).describe("The question text shown to the user."),
    choices: z.array(z.string().min(1).max(2_000)).length(4).describe("Exactly 4 plausible options."),
    correctAnswer: z
      .string()
      .min(1)
      .max(2_000)
      .describe("The exact text of the correct option, character-for-character identical to one of the choices entries."),
    explanation: z
      .string()
      .min(1)
      .max(8_000)
      .describe("Concise rationale shown to the user after they answer."),
    source: quizItemSourceEnum.describe(
      "Which input material this question is grounded in: 'statement' (problem statement), 'submission' (the user's submitted code), 'notes' (the user's saved notes), or 'card' (an existing flashcard). NOT a category of question type — that is `scope`.",
    ),
    scope: quizItemScopeEnum.describe(
      "What pedagogical dimension this question tests: 'approach', 'invariant', 'edge_case', 'complexity', 'implementation', or 'mistake_review'. NOT where the content came from — that is `source`.",
    ),
  })
  .refine(
    (item) => {
      const norm = (s: string) => s.trim();
      return item.choices.map(norm).includes(norm(item.correctAnswer));
    },
    {
      message: "correctAnswer must exactly match one of the choices (after trimming)",
      path: ["correctAnswer"],
    },
  );
export type QuizDraftItem = z.infer<typeof quizDraftItemSchema>;

export const quizDraftSchema = z.object({
  items: z.array(quizDraftItemSchema).length(5),
});
export type QuizDraft = z.infer<typeof quizDraftSchema>;

/** POST /api/problems/:id/user-card — saves a manual card directly as ready. */
export const userCardManualCreateSchema = z.object({
  mode: z.literal("manual"),
  question: z.string().min(1).max(5_000),
  answer: z.string().min(1).max(20_000),
});

export type UserCardManualCreateInput = z.infer<typeof userCardManualCreateSchema>;

/** Durable async generation command shared by the web app and extension. */
export const aiJobCreateRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("card_generate"),
    problemId: z.string().min(1).max(64),
    requestId: z.string().uuid(),
    rawText: z.string().max(6_000).optional(),
  }),
  z.object({
    action: z.literal("card_followup"),
    problemId: z.string().min(1).max(64),
    requestId: z.string().uuid(),
    cardId: z.string().min(1).max(64),
    expectedCardVersion: z.number().int().positive(),
    draft: cardDraftSchema,
    instruction: z.string().min(1).max(4_000),
  }),
  z.object({
    action: z.enum(["quiz_generate", "quiz_regenerate", "quiz_next_batch"]),
    problemId: z.string().min(1).max(64),
    requestId: z.string().uuid(),
    expectedQuizSessionId: z.string().min(1).max(64).nullable(),
  }),
]);
export type AiJobCreateRequestInput = z.infer<typeof aiJobCreateRequestSchema>;

/** PATCH /api/cards/:id — edit question/answer or confirm a candidate card. */
export const updateCardPatchSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    aiStatus: z.literal("ready").optional(),
    question: z.string().min(1).max(5_000).optional(),
    answer: z.string().min(1).max(20_000).optional(),
  })
  .strict()
  .refine((o) => o.aiStatus !== undefined || o.question !== undefined || o.answer !== undefined, {
    message: "empty_patch",
  });

export const fsrsRatingSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

export const reviewRatingSchema = z.object({
  problemId: z.string().min(1).max(64),
  rating: fsrsRatingSchema,
  notes: z.string().max(50_000).optional(),
  // Optional for older extension builds. Current clients always send it so a
  // network retry cannot schedule the same review twice.
  requestId: z.string().uuid().optional(),
});
export type ReviewRatingInput = z.infer<typeof reviewRatingSchema>;

/** PATCH /api/problems/:id — autosave notes from review, or archive/unarchive. */
export const problemPatchSchema = z
  .object({
    notes: z.string().max(50_000).optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((o) => o.notes !== undefined || o.archived !== undefined, { message: "empty_patch" });

/** POST /api/review/undo — revert the most recent rating of a problem. */
export const reviewUndoSchema = z.object({
  problemId: z.string().min(1).max(64),
});
export type ReviewUndoInput = z.infer<typeof reviewUndoSchema>;

export const quizAnswerRequestSchema = z.object({
  itemId: z.string().min(1),
  selectedIndex: z.number().int().min(0).max(3),
});

export const quizSaveCardRequestSchema = z.object({
  itemId: z.string().min(1),
});

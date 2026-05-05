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
export const cardAiStatusEnum = z.enum(["candidate", "failed", "ready"]);

/* Payload sent by the Chrome extension to add or update a problem. */
export const captureProblemSchema = z.object({
  leetcodeSlug: z.string().min(1),
  leetcodeId: z.number().int().optional(),
  title: z.string().min(1),
  difficulty: difficultyEnum,
  url: z.string().url(),
  descriptionMd: z.string().optional(),
  topicTags: z.array(z.string()).default([]),
  similarSlugs: z.array(z.string()).default([]),
  notes: z.string().optional(),
  submissions: z
    .array(
      z.object({
        language: z.string(),
        code: z.string(),
        status: submissionStatusEnum,
        runtimeMs: z.number().int().optional(),
        memoryKb: z.number().int().optional(),
        failedTestcase: z.string().optional(),
        expectedOutput: z.string().optional(),
        actualOutput: z.string().optional(),
        errorMessage: z.string().optional(),
        submittedAt: z.string().datetime().optional(),
      }),
    )
    .default([]),
});
export type CaptureProblemInput = z.infer<typeof captureProblemSchema>;

/** A flash card: question (front) and answer (back). */
export const cardDraftSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
});
export type CardDraft = z.infer<typeof cardDraftSchema>;

export const aiCardsRequestSchema = z.union([
  z.object({
    mode: z.literal("single"),
    action: z.literal("generate"),
    rawText: z.string().max(6000).optional(),
  }),
  z.object({
    mode: z.literal("single"),
    action: z.literal("followup"),
    cardId: z.string().min(1),
    draft: cardDraftSchema,
    instruction: z.string().min(1).max(4000),
  }),
]);

/** POST /api/problems/:id/user-card — saves a manual card directly as ready. */
export const userCardManualCreateSchema = z.object({
  mode: z.literal("manual"),
  question: z.string().min(1),
  answer: z.string().min(1),
});

export type AiCardsRequestInput = z.infer<typeof aiCardsRequestSchema>;
export type UserCardManualCreateInput = z.infer<typeof userCardManualCreateSchema>;

/** PATCH /api/cards/:id — edit question/answer or confirm a candidate card. */
export const updateCardPatchSchema = z
  .object({
    aiStatus: z.literal("ready").optional(),
    question: z.string().min(1).optional(),
    answer: z.string().min(1).optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: "empty_patch" });

export const fsrsRatingSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

export const reviewRatingSchema = z.object({
  problemId: z.string(),
  rating: fsrsRatingSchema,
  notes: z.string().optional(),
});

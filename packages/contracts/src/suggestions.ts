import { z } from "zod";
import { leetcodeSlugSchema, type SkillDimensionId } from "./schemas";

/**
 * New-problem suggestions: attempted-problem history. A problem is never
 * suggested as new once any source shows an attempt; nothing here claims the
 * history is complete unless a coverage scope was read to the end.
 */

export const attemptStatusEnum = z.enum(["attempted", "accepted"]);
export type AttemptStatus = z.infer<typeof attemptStatusEnum>;

export const attemptCoverageScopeEnum = z.enum(["problem_list_accepted", "problem_list_tried"]);
export type AttemptCoverageScope = z.infer<typeof attemptCoverageScopeEnum>;

/** POST /api/attempt-history: attempted problems read from LeetCode, or stated by the user. */
export const attemptHistoryMergeSchema = z
  .object({
    source: z.enum(["leetcode_status", "user_marked"]),
    /** The LeetCode account the entries were read from (required for LeetCode sources). */
    sourceAccount: z.string().min(1).max(64).nullable(),
    entries: z
      .array(z.object({ slug: leetcodeSlugSchema, status: attemptStatusEnum }).strict())
      .max(500),
    /** How far a problem-list read got; `complete` only after its last page. */
    coverage: z
      .object({
        scope: attemptCoverageScopeEnum,
        read: z.number().int().min(0).max(20_000),
        total: z.number().int().min(0).max(20_000).nullable(),
        complete: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((value) => value.source !== "leetcode_status" || value.sourceAccount !== null, {
    message: "LeetCode history needs the account it was read from.",
    path: ["sourceAccount"],
  })
  .refine((value) => !value.coverage || value.source === "leetcode_status", {
    message: "Coverage describes a LeetCode history read.",
    path: ["coverage"],
  });
export type AttemptHistoryMergeInput = z.infer<typeof attemptHistoryMergeSchema>;

export type AttemptHistoryCoverageDto = {
  scope: AttemptCoverageScope;
  sourceAccount: string;
  read: number;
  total: number | null;
  complete: boolean;
  syncedAt: string;
};

/** POST /api/suggestions: the day's suggestion (one per local day), or one more. */
export const suggestionAllocateSchema = z
  .object({ requestId: z.string().uuid(), kind: z.enum(["daily", "extra"]) })
  .strict();
export type SuggestionAllocateInput = z.infer<typeof suggestionAllocateSchema>;

/** POST /api/suggestions/:id/actions: each suggestion is acted on once. */
export const suggestionActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("skip"), requestId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("already_attempted"), requestId: z.string().uuid() }).strict(),
  /** Starts (or resumes) the practice session; the tab that opens binds the token. */
  z.object({ action: z.literal("start"), requestId: z.string().uuid(), ownerToken: z.string().uuid() }).strict(),
]);
export type SuggestionActionInput = z.infer<typeof suggestionActionSchema>;

export type GeneralPracticeWhy = "not_personalized" | "no_focus" | "rotation" | "no_targeted_candidate";

/** An explanation; each states only what the stored metadata shows. */
export type SuggestionReasonDto =
  | { code: "category_focus"; category: SkillDimensionId; contexts: number }
  | { code: "similar_to"; problemId: string; title: string; category: SkillDimensionId | null }
  | { code: "topic_match"; topic: string }
  | { code: "general_practice"; why: GeneralPracticeWhy };

export type SuggestionStatus = "pending" | "started" | "skipped" | "already_attempted";

export type SuggestionDto = {
  id: string;
  dateKey: string;
  /** 0 is the day's suggestion; later ones are extras or replacements. */
  ordinal: number;
  kind: "daily" | "extra" | "replacement";
  replacesId: string | null;
  target: { slug: string; title: string; difficulty: "Easy" | "Medium" | "Hard"; topicTags: string[]; url: string };
  /** The skill dimension it targets; null for general practice. */
  category: SkillDimensionId | null;
  lane: "personalized" | "general";
  reasons: SuggestionReasonDto[];
  plannerVersion: string;
  /** Never "new" without a complete read of the LeetCode history. */
  novelty: "no_prior_attempt_found" | "unverified";
  status: SuggestionStatus;
  practiceSessionId: string | null;
  /** The started session's result once it completed; it follows the normal
   *  initial-learning and review rules. */
  outcome: "accepted" | "failed" | "unknown" | null;
  verifiedAt: string;
  createdAt: string;
  actedAt: string | null;
};

/** GET /api/suggestions: today's suggestions, oldest first. */
export type SuggestionListDto = { dateKey: string; suggestions: SuggestionDto[] };

export type SuggestionAllocateResponseDto =
  | { suggestion: SuggestionDto; idempotentReplay: boolean }
  /** No eligible problem: nothing already attempted is ever offered instead. */
  | { suggestion: null; reason: "no_candidates" };

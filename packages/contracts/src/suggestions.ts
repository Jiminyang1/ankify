import { z } from "zod";
import { leetcodeSlugSchema } from "./schemas";

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

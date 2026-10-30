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
/** "default", "off", or a provider-native effort; validated per model on save. */
export const aiReasoningLevelSchema = z.string().trim().min(1).max(32).regex(/^[a-z]+$/);

export const agentPageEnum = z.enum([
  "today",
  "review",
  "problems",
  "problem",
  "analysis",
  "settings",
  "extension",
  "profile",
  "leetcode",
]);
export const agentPanelEnum = z.enum(["quiz", "cards", "submissions", "notes", "docs", "weak_spots", "overview"]);
export const agentRunStatusEnum = z.enum(["running", "succeeded", "failed"]);
export const agentStepStatusEnum = z.enum([
  "completed",
  "pending",
  "accepted",
  "dismissed",
  "failed",
]);

/** The LeetCode problem open next to the extension's side panel. The editor
 *  snapshot is what the user is writing right now; only the newest turn keeps
 *  it (see getAgentModelMessages). */
export const agentLeetcodeContextSchema = z
  .object({
    slug: z.string().min(1).max(256),
    title: z.string().min(1).max(512).optional(),
    editor: z
      .object({
        language: z.string().min(1).max(64),
        code: z.string().max(20_000),
      })
      .strict()
      .optional(),
  })
  .strict();
export type AgentLeetcodeContext = z.infer<typeof agentLeetcodeContextSchema>;

export const agentPageContextSchema = z
  .object({
    page: agentPageEnum,
    activePanel: agentPanelEnum,
    problemId: z.string().min(1).max(64).nullable(),
    leetcode: agentLeetcodeContextSchema.optional(),
    /** Set by the server while a talk-through practice session is active on
     *  this problem: what to ask about and what's been graded. */
    practiceActive: z
      .object({
        practiceSessionId: z.string().min(1).max(64),
        targets: z
          .array(
            z
              .object({
                id: z.string().max(80),
                kind: z.enum(["weakness", "category", "core"]),
                category: z.string().max(40).nullable(),
                label: z.string().max(400),
                grade: z.enum(["correct", "partial", "missed"]).nullable(),
                followUps: z.number().int().min(0).max(5).optional(),
              })
              .strict(),
          )
          .max(5),
        /** What the Coach does with this reply, decided by the server from
         *  the judge's reading (version 3). Plain text. */
        instruction: z.string().max(6_000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type AgentPageContext = z.infer<typeof agentPageContextSchema>;

export const agentModelChoiceSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/),
    reasoningLevel: z.string().regex(/^[a-z]{1,16}$/).optional(),
  })
  .strict();
export type AgentModelChoice = z.infer<typeof agentModelChoiceSchema>;

export const agentTurnRequestSchema = z
  .object({
    sessionId: z.string().min(1).max(64).nullable(),
    requestId: z.string().uuid(),
    message: z.string().trim().min(1).max(12_000),
    context: agentPageContextSchema,
    /** Instead of typed text: the Coach asks a talk-through's first question
     *  (practice_start), or reads the failed submissions first
     *  (analyze_attempts). practice_completed is legacy: extension builds
     *  0.3.x send it for a stage-2 practice session, and it's refused (410). */
    trigger: z
      .object({
        type: z.enum(["practice_start", "analyze_attempts", "practice_completed"]),
        /** Required for the practice triggers. */
        practiceSessionId: z.string().min(1).max(64).optional(),
      })
      .strict()
      .refine((value) => value.type === "analyze_attempts" || Boolean(value.practiceSessionId), {
        message: "practiceSessionId is required",
      })
      .optional(),
    /** A model and reasoning level for this turn instead of the Settings ones.
     *  Only honored with the user's own key, on the same provider. */
    model: agentModelChoiceSchema.optional(),
  })
  .strict();
export type AgentTurnRequestInput = z.infer<typeof agentTurnRequestSchema>;

export const agentSessionPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
  })
  .strict();
export type AgentSessionPatchInput = z.infer<typeof agentSessionPatchSchema>;

/* ── Problem docs (docs/coach-practice.md) ── */

/** "cards" is legacy: the Cards doc moved into Notes (migration 0025), and
 *  only older extension builds (0.3.x, with a Cards tab) still read or write it. */
export const problemDocTargetEnum = z.enum(["notes", "cards", "solutions"]);
export type ProblemDocTarget = z.infer<typeof problemDocTargetEnum>;

const docSection = z.string().trim().min(1).max(60);
const docMarkdown = z.string().max(20_000);

/** One edit to a problem's Notes doc, as the Coach proposes it. */
export const docEditSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("append_section"), section: docSection, markdown: docMarkdown.min(1) }).strict(),
  z.object({ op: z.literal("replace_section"), section: docSection, markdown: docMarkdown }).strict(),
]);
export type DocEdit = z.infer<typeof docEditSchema>;

/** Card edits the Coach proposed before the Cards doc moved into Notes. Old
 *  runs can still hold one; it renders without a preview and can't be applied. */
const legacyCardEditSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_card"), prompt: z.string(), answer: z.string() }),
  z.object({ op: z.literal("update_card"), key: z.string(), prompt: z.string().optional(), answer: z.string().optional() }),
  z.object({ op: z.literal("remove_card"), key: z.string() }),
]);
export type LegacyCardEdit = z.infer<typeof legacyCardEditSchema>;

export function isLegacyCardEdit(edit: DocEdit | LegacyCardEdit): edit is LegacyCardEdit {
  return edit.op === "add_card" || edit.op === "update_card" || edit.op === "remove_card";
}

/** PATCH /api/weaknesses/:id: the user removes, resolves, or reopens one. */
export const weaknessPatchSchema = z
  .object({ status: z.enum(["active", "resolved", "dismissed"]) })
  .strict();

/** PUT /api/problems/:id/docs: the user's own edit of one doc. */
export const problemDocPutSchema = z
  .object({
    target: problemDocTargetEnum,
    markdown: z.string().max(50_000),
    expectedVersion: z.number().int().min(0),
  })
  .strict();

export const agentProposalSchema = z.discriminatedUnion("action", [
  /** Card and quiz generation the Coach proposed before it was removed. Old
   *  runs can still hold one; approving it fails with a message. */
  z.object({
    action: z.enum(["card_generate", "quiz_generate", "quiz_regenerate", "quiz_next_batch"]),
    problemId: z.string(),
    reason: z.string(),
  }),
  /** A new weakness category; added to the user's list on approval. */
  z.object({
    action: z.literal("weakness_category"),
    key: z.string().regex(/^[a-z][a-z0-9_]{2,39}$/),
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().min(1).max(200),
    reason: z.string().min(1).max(500),
  }),
  /** An edit to the problem's Notes doc, applied on approval. */
  z.object({
    action: z.literal("doc_edit"),
    problemId: z.string().min(1).max(64),
    edit: z.union([docEditSchema, legacyCardEditSchema]),
    /** The doc version the edit was checked against. */
    baseVersion: z.number().int().min(0),
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
  /** For a problem new to the deck: "next_day" when the extension collects it
   *  right after the user worked on it, so it isn't due at once. Ignored for
   *  problems already in the deck. */
  firstReview: z.enum(["now", "next_day"]).optional(),
});
export type CaptureProblemInput = z.infer<typeof captureProblemSchema>;

/* ── Practice (docs/coach-practice.md) ── */

/** POST /api/practice/:id/dispute: "I did say that" on a settled target. */
export const practiceDisputeSchema = z.object({ targetId: z.string().min(1).max(80) }).strict();

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

/** POST /api/leetcode/account — a LeetCode username or profile URL. */
export const leetcodeAccountLinkSchema = z.object({
  profile: z.string().trim().min(1).max(200),
});

/** POST /api/problems/by-slug/:slug/submissions — append-only sync of
 *  submissions ankify is missing for an already-captured problem. */
export const submissionSyncSchema = z.object({
  submissions: z.array(captureSubmissionSchema).min(1).max(20),
});

/** POST /api/leetcode/solved — the extension's snapshot of every problem the
 *  signed-in LeetCode user has solved. Slugs only; no code or session data. */
export const leetcodeSolvedSyncSchema = z.object({
  username: z.string().trim().min(1).max(64),
  slugs: z.array(z.string().min(1).max(256)).max(6_000),
});
export type LeetcodeSolvedSyncInput = z.infer<typeof leetcodeSolvedSyncSchema>;

/** POST /api/profile/add-to-review — study-plan problems to put in the deck. */
export const addToReviewSchema = z.object({
  slugs: z.array(z.string().min(1).max(256)).min(1).max(30),
});

/** POST /api/study-plan (switch) and DELETE /api/study-plan (remove an
 *  imported list): an official plan slug or `list:<leetcode list slug>`. */
export const studyPlanSelectSchema = z.object({
  plan: z.string().min(1).max(100),
});

/** POST /api/study-plan/import — a public LeetCode problem list link. */
export const studyPlanImportSchema = z.object({
  link: z.string().trim().min(1).max(500),
});

import { z } from "zod";
import { captureProblemSchema, captureSubmissionSchema, difficultyEnum, fsrsRatingSchema, submissionStatusEnum } from "./schemas";

export const practiceSessionTypeEnum = z.enum(["initial_learning", "scheduled_review", "voluntary_practice"]);
export const reviewIntentEnum = z.enum(["due", "early", "none"]);
export const practiceSessionStatusEnum = z.enum(["active", "interrupted", "completed", "abandoned"]);
export const practiceSessionOutcomeEnum = z.enum(["accepted", "failed", "unknown"]);
export const ratingDispositionEnum = z.enum([
  "not_applicable",
  "pending",
  "deferred",
  "submitted",
  "dismissed",
  "expired",
  "superseded",
  "undone",
]);
export const practiceModeEnum = z.enum(["practice", "due_review", "early_review"]);
export const baselineStateEnum = z.enum(["pending", "established", "none", "unavailable"]);
export const captureCompletenessEnum = z.enum(["complete", "partial", "unavailable"]);
/** What the extension's LeetCode adapter could read. An error is never "no submissions". */
export const leetcodeAvailabilityEnum = z.enum(["available", "signed_out", "unavailable", "partial"]);
export const observationDetailStatusEnum = z.enum(["complete", "pending", "unavailable", "capacity_blocked"]);
export const observationAssociationEnum = z.enum(["automatic", "ambiguous", "confirmed", "rejected"]);

export type PracticeSessionTypeId = z.infer<typeof practiceSessionTypeEnum>;
export type ReviewIntentId = z.infer<typeof reviewIntentEnum>;
export type PracticeSessionStatusId = z.infer<typeof practiceSessionStatusEnum>;
export type PracticeSessionOutcomeId = z.infer<typeof practiceSessionOutcomeEnum>;
export type RatingDispositionId = z.infer<typeof ratingDispositionEnum>;
export type PracticeModeId = z.infer<typeof practiceModeEnum>;
export type LeetcodeAvailability = z.infer<typeof leetcodeAvailabilityEnum>;

/** LeetCode submission ids are decimal strings; the session API compares them numerically. */
export const leetcodeSubmissionIdSchema = z.string().regex(/^\d{1,20}$/);
/** A random id the extension generates per tab and keeps across reloads. */
export const ownerTokenSchema = z.string().uuid();
const leetcodeAccountSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/);
const occurredAtSchema = z.string().datetime();

/** Problem metadata the content script reads from LeetCode. Strict: notes and
 *  submissions travel through their own endpoints. */
export const practiceProblemSchema = captureProblemSchema.omit({ notes: true, submissions: true }).strict();
export type PracticeProblemInput = z.infer<typeof practiceProblemSchema>;

/** Newest LeetCode submission id seen before the session started. */
export const sessionBaselineSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("established"), leetcodeSubmissionId: leetcodeSubmissionIdSchema }).strict(),
  /** The problem had no submissions at all. */
  z.object({ state: z.literal("none") }).strict(),
  /** LeetCode could not be read; association falls back to submission times. */
  z.object({ state: z.literal("unavailable") }).strict(),
]);
export type SessionBaselineInput = z.infer<typeof sessionBaselineSchema>;

/** POST /api/practice-sessions — start, or resume the open session. */
export const practiceSessionStartSchema = z
  .object({
    requestId: z.string().uuid(),
    target: z.discriminatedUnion("kind", [
      /** An Ankify problem, e.g. opened from the review queue. */
      z.object({ kind: z.literal("problem"), problemId: z.string().min(1).max(64) }).strict(),
      /** The LeetCode page the user is on; creates the problem if it is new. */
      z.object({ kind: z.literal("leetcode"), problem: practiceProblemSchema }).strict(),
    ]),
    mode: practiceModeEnum,
    ownerToken: ownerTokenSchema,
    /** Omitted when the session starts before the problem page is open. */
    baseline: sessionBaselineSchema.optional(),
    sourceAccount: leetcodeAccountSchema.optional(),
    /** Starting a session discards another session's pending rating only when explicit. */
    supersedePendingRating: z.boolean().default(false),
  })
  .strict();
export type PracticeSessionStartInput = z.infer<typeof practiceSessionStartSchema>;

const MAX_TRACKED_MS = 7 * 24 * 60 * 60 * 1000;
const ownedCommand = { requestId: z.string().uuid(), ownerToken: ownerTokenSchema };

/** POST /api/practice-sessions/:id/commands */
export const practiceSessionCommandSchema = z.discriminatedUnion("type", [
  /** Cumulative for the reporting tab; merged with max(), so it needs no request id. */
  z
    .object({
      type: z.literal("heartbeat"),
      ownerToken: ownerTokenSchema,
      activeMs: z.number().int().min(0).max(MAX_TRACKED_MS),
      observedMs: z.number().int().min(0).max(MAX_TRACKED_MS),
      availability: leetcodeAvailabilityEnum.optional(),
    })
    .strict(),
  /** The owning tab closed: the session reads as interrupted at once rather
   *  than when its lease runs out. Only the owner releases; repeating it
   *  changes nothing. */
  z.object({ type: z.literal("release"), ownerToken: ownerTokenSchema }).strict(),
  z.object({ type: z.literal("resume"), ...ownedCommand }).strict(),
  /** "Continue here": move control to this tab. */
  z.object({ type: z.literal("takeover"), ...ownedCommand }).strict(),
  /** `problem`: metadata the page just read from LeetCode; refreshes a problem
   *  whose session started elsewhere (the popup, a suggestion). */
  z.object({ type: z.literal("set_baseline"), ...ownedCommand, baseline: sessionBaselineSchema, problem: practiceProblemSchema.optional() }).strict(),
  z
    .object({
      type: z.literal("finish"),
      ...ownedCommand,
      /** "solved" becomes an accepted outcome only with Accepted evidence. */
      result: z.enum(["solved", "unsuccessful"]),
      occurredAt: occurredAtSchema,
    })
    .strict(),
  z.object({ type: z.literal("abandon"), ...ownedCommand, occurredAt: occurredAtSchema }).strict(),
  /** Retired ("Rate later"): rating is due right after Finish. Still parsed so
   *  an older extension's queued request gets `rating_defer_retired`. */
  z.object({ type: z.literal("defer_rating"), requestId: z.string().uuid() }).strict(),
  z.object({ type: z.literal("dismiss_rating"), requestId: z.string().uuid() }).strict(),
  /** Reverts this session's rating if no later scheduling change happened.
   *  An undone session can never be rated again. */
  z.object({ type: z.literal("undo_rating"), requestId: z.string().uuid() }).strict(),
]);
export type PracticeSessionCommandInput = z.infer<typeof practiceSessionCommandSchema>;

/** POST /api/practice-sessions/:id/rating — one FSRS rating per completed
 *  review, chosen explicitly (no default), scheduled from the completion time. */
export const practiceSessionRatingSchema = z
  .object({ requestId: z.string().uuid(), rating: fsrsRatingSchema })
  .strict();
export type PracticeSessionRatingInput = z.infer<typeof practiceSessionRatingSchema>;

/** Code and judge output fetched from LeetCode for one submission. */
export const observationDetailSchema = captureSubmissionSchema.omit({
  leetcodeSubmissionId: true,
  status: true,
  submittedAt: true,
});

export const sessionObservationSchema = z
  .object({
    leetcodeSubmissionId: leetcodeSubmissionIdSchema.optional(),
    /** Durable id for an observation LeetCode reported without a submission id. */
    clientObservationId: z.string().uuid().optional(),
    verdict: submissionStatusEnum,
    submittedAt: occurredAtSchema.optional(),
    detail: observationDetailSchema.optional(),
    /** The extension stopped retrying the detail fetch. */
    detailUnavailable: z.boolean().optional(),
  })
  .strict()
  .refine((observation) => observation.leetcodeSubmissionId || observation.clientObservationId, {
    message: "identity_required",
  });
export type SessionObservationInput = z.infer<typeof sessionObservationSchema>;

/** POST /api/practice-sessions/:id/submissions — bounded like capture. */
export const practiceSessionSubmissionsSchema = z
  .object({ observations: z.array(sessionObservationSchema).min(1).max(20) })
  .strict();
export type PracticeSessionSubmissionsInput = z.infer<typeof practiceSessionSubmissionsSchema>;

/** GET /api/practice-sessions/current */
export const practiceSessionCurrentQuerySchema = z
  .object({
    problemId: z.string().min(1).max(64).optional(),
    slug: z.string().min(1).max(256).optional(),
  })
  .refine((query) => Boolean(query.problemId) !== Boolean(query.slug), { message: "problem_id_or_slug" });

/** GET /api/practice-sessions — newest first. */
export const practiceSessionListQuerySchema = z.object({
  problemId: z.string().min(1).max(64).optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type PracticeSessionListQuery = z.infer<typeof practiceSessionListQuerySchema>;

export type PracticeSessionDto = {
  id: string;
  problemId: string;
  type: PracticeSessionTypeId;
  reviewMethod: "leetcode_full_solve";
  reviewIntent: ReviewIntentId;
  /** Effective: `active` without a live owner reads as `interrupted`. */
  status: PracticeSessionStatusId;
  /** Inactive for over 24 hours: history only, a new session is required. */
  stale: boolean;
  outcome: PracticeSessionOutcomeId | null;
  revision: number;
  /** Relative to the owner token the request carried. */
  ownership: "you" | "other_tab" | "none";
  rating: {
    disposition: RatingDispositionId;
    expiresAt: string | null;
  };
  capture: {
    completeness: z.infer<typeof captureCompletenessEnum>;
    baselineState: z.infer<typeof baselineStateEnum>;
    /** Newest LeetCode submission id seen before the start, when established. */
    baselineSubmissionId: string | null;
  };
  timing: {
    startedAt: string;
    lastActivityAt: string;
    completedAt: string | null;
    /** The completion time came from the client and had to be clamped or filled in. */
    completedAtAdjusted: boolean;
    wallMs: number;
    /** Estimated foreground time; never actual solving time. */
    activeMs: number;
    /** Time the extension was tracking; `observedMs / wallMs` is the coverage. */
    observedMs: number;
  };
  evidence: {
    submissions: number;
    accepted: number;
    failed: number;
    pendingDetails: number;
    ambiguous: number;
    firstAcceptedAt: string | null;
  };
  sourceAccount: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PracticeProblemStatusDto = {
  id: string;
  leetcodeSlug: string;
  title: string;
  difficulty: z.infer<typeof difficultyEnum>;
  url: string;
  enrollment: "enrolled" | "awaiting_initial";
  archived: boolean;
  fsrsState: "new" | "learning" | "review" | "relearning";
  fsrsDue: string | null;
  /** Enrolled, not archived, and due now. */
  due: boolean;
  scheduleRevision: number;
};

export type PracticeSessionObservationDto = {
  id: string;
  leetcodeSubmissionId: string | null;
  clientObservationId: string | null;
  submissionId: string | null;
  verdict: z.infer<typeof submissionStatusEnum>;
  submittedAt: string | null;
  firstObservedAt: string;
  detailStatus: z.infer<typeof observationDetailStatusEnum>;
  association: z.infer<typeof observationAssociationEnum>;
};

export type PracticeSessionSummaryDto = {
  attempts: number;
  failedBeforeAccepted: number;
  firstTryAccepted: boolean;
  firstAcceptedAt: string | null;
  /** Oldest first, consecutive repeats collapsed. */
  sequence: { verdict: string; count: number }[];
};

export type PracticeSessionDetailDto = {
  session: PracticeSessionDto;
  problem: PracticeProblemStatusDto;
  observations: PracticeSessionObservationDto[];
  /** Verdict and correction sequence of the associated submissions. */
  summary: PracticeSessionSummaryDto;
};

export type PracticeSessionCurrentDto = {
  /** Null when the problem is not in Ankify. */
  problem: PracticeProblemStatusDto | null;
  /** The open session, if any (active or interrupted within 24 hours). */
  session: PracticeSessionDto | null;
  /** A completed review still waiting for its rating. */
  pendingRating: PracticeSessionDto | null;
  /** The latest session completed in the last 7 days (what analysis refers to). */
  recentCompleted: PracticeSessionDto | null;
};

export type PracticeSessionListDto = {
  sessions: PracticeSessionDto[];
  nextCursor: string | null;
};

export type PracticeSessionStartResponseDto = {
  ok: true;
  session: PracticeSessionDto;
  problem: PracticeProblemStatusDto;
  /** A new session was created; false when the open session was resumed. */
  created: boolean;
  problemCreated: boolean;
  unarchived: boolean;
  /** Sessions whose pending rating this start explicitly superseded. */
  supersededSessionIds: string[];
  idempotentReplay: boolean;
};

export type PracticeSessionCommandResponseDto = {
  ok: true;
  session: PracticeSessionDto;
  idempotentReplay: boolean;
};

export type PracticeSessionRatingResponseDto = {
  ok: true;
  session: PracticeSessionDto;
  problem: PracticeProblemStatusDto;
  nextDue: string | null;
  idempotentReplay: boolean;
};

export type SessionObservationOutcome =
  | "recorded"
  | "recorded_pending_detail"
  | "enriched"
  | "duplicate"
  | "ambiguous"
  | "outside_session"
  | "conflict"
  | "capacity_blocked";

export type PracticeSessionSubmissionsResponseDto = {
  ok: true;
  session: PracticeSessionDto;
  results: { index: number; outcome: SessionObservationOutcome; observationId: string | null }[];
};

export type PracticeSessionErrorCode =
  | "session_not_found"
  | "problem_not_found"
  | "not_enrolled"
  | "not_due"
  | "open_session_conflict"
  /** The open session was started with a different LeetCode account. */
  | "account_mismatch"
  | "rating_pending"
  | "not_owner"
  | "session_stale"
  | "invalid_transition"
  | "baseline_already_set"
  | "rating_not_pending"
  /** "Rate later" is retired: rate or skip right after Finish. */
  | "rating_defer_retired"
  /** A later scheduling change happened; Undo would overwrite it. */
  | "undo_conflict"
  | "nothing_to_undo"
  | "request_conflict"
  | "duplicate_problem_conflict"
  | "problem_limit_reached"
  | "workflow_disabled";

export type PracticeSessionErrorDto = {
  error: PracticeSessionErrorCode;
  message?: string;
  /** The session the conflict is about, when there is one. */
  session?: PracticeSessionDto;
  /** That session's problem, when it is another problem (`rating_pending`). */
  problem?: PracticeProblemStatusDto;
};

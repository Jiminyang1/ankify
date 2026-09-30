import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey, check, foreignKey } from "drizzle-orm/sqlite-core";
import type {
  AgentNavigation,
  AgentPageContext,
  AgentProposal,
  QuizAnswer,
  QuizItem,
} from "@ankify/contracts";

const ts = (name: string) =>
  integer(name, { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`);

const optTs = (name: string) => integer(name, { mode: "timestamp_ms" });

/* ────────────────────────────────────────────────────────────────────────────
 * Better Auth
 * Tables are named/exported to match Better Auth's Drizzle adapter models.
 * ──────────────────────────────────────────────────────────────────────────── */
export const user = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
    image: text("image"),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => ({
    emailIdx: uniqueIndex("user_email_unique").on(t.email),
  }),
);

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => ({
    tokenIdx: uniqueIndex("session_token_unique").on(t.token),
    userIdx: index("session_user_idx").on(t.userId),
  }),
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    accountId: text("account_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: optTs("access_token_expires_at"),
    refreshTokenExpiresAt: optTs("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => ({
    userIdx: index("account_user_idx").on(t.userId),
    providerAccountIdx: uniqueIndex("account_provider_account_unique").on(t.providerId, t.accountId),
  }),
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => ({
    identifierIdx: index("verification_identifier_idx").on(t.identifier),
  }),
);

/* ────────────────────────────────────────────────────────────────────────────
 * problems
 * One row per LeetCode problem the user is studying.
 * FSRS state lives directly on the problem row (single source of truth for
 * next-review scheduling).
 * ──────────────────────────────────────────────────────────────────────────── */
export const problems = sqliteTable(
  "problems",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    leetcodeSlug: text("leetcode_slug").notNull(),
    leetcodeId: integer("leetcode_id"),
    title: text("title").notNull(),
    difficulty: text("difficulty", { enum: ["Easy", "Medium", "Hard"] }).notNull(),
    url: text("url").notNull(),
    descriptionMd: text("description_md"),
    topicTags: text("topic_tags", { mode: "json" }).$type<string[]>().notNull().default(sql`(json('[]'))`),
    similarSlugs: text("similar_slugs", { mode: "json" }).$type<string[]>().notNull().default(sql`(json('[]'))`),
    notes: text("notes"),

    // FSRS-6 state
    fsrsDue: optTs("fsrs_due"),
    fsrsStability: real("fsrs_stability"),
    fsrsDifficulty: real("fsrs_difficulty"),
    fsrsElapsedDays: real("fsrs_elapsed_days"),
    fsrsScheduledDays: real("fsrs_scheduled_days"),
    fsrsLearningSteps: integer("fsrs_learning_steps").notNull().default(0),
    fsrsReps: integer("fsrs_reps").notNull().default(0),
    fsrsLapses: integer("fsrs_lapses").notNull().default(0),
    fsrsState: text("fsrs_state", { enum: ["new", "learning", "review", "relearning"] })
      .notNull()
      .default("new"),
    fsrsLastReview: optTs("fsrs_last_review"),
    // Monotonic: incremented by every write to the FSRS fields above (ratings,
    // Undo, initial scheduling). A pending session rating or Undo is rejected
    // when the revision it observed is no longer current.
    scheduleRevision: integer("schedule_revision").notNull().default(0),
    // `awaiting_initial`: created by a practice session whose initial learning
    // has not completed yet; excluded from the review queue until it does.
    enrollment: text("enrollment", { enum: ["enrolled", "awaiting_initial"] })
      .notNull()
      .default("enrolled"),

    archivedAt: optTs("archived_at"),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => ({
    // userId-scoped composite indexes below cover every query path. A bare
    // (fsrsDue) or (leetcodeSlug) index is never used on its own — every query
    // filters by userId first — so they only added write overhead.
    userIdx: index("problems_user_idx").on(t.userId),
    userArchivedDueIdx: index("problems_user_archived_due_idx").on(t.userId, t.archivedAt, t.fsrsDue),
    // Matches the problems list's keyset pagination order so it reads straight
    // off the index instead of sorting the whole deck in a temp b-tree.
    userArchivedCreatedIdx: index("problems_user_archived_created_idx").on(
      t.userId,
      t.archivedAt,
      t.createdAt,
      t.id,
    ),
    userSlugIdx: uniqueIndex("problems_user_slug_unique").on(t.userId, t.leetcodeSlug),
    userLeetcodeIdIdx: uniqueIndex("problems_user_leetcode_id_unique").on(t.userId, t.leetcodeId),
  }),
);

/* ────────────────────────────────────────────────────────────────────────────
 * submissions
 * Code the user wrote on LeetCode. Both passing and failing — failures are
 * useful context for AI-assisted card drafting.
 * ──────────────────────────────────────────────────────────────────────────── */
export const submissions = sqliteTable(
  "submissions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    problemId: text("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    leetcodeSubmissionId: text("leetcode_submission_id"),
    language: text("language").notNull(),
    code: text("code").notNull(),
    status: text("status", {
      enum: [
        "Accepted",
        "Wrong Answer",
        "Time Limit Exceeded",
        "Memory Limit Exceeded",
        "Runtime Error",
        "Compile Error",
        "Other",
      ],
    }).notNull(),
    runtimeMs: integer("runtime_ms"),
    memoryKb: integer("memory_kb"),
    failedTestcase: text("failed_testcase"),
    expectedOutput: text("expected_output"),
    actualOutput: text("actual_output"),
    errorMessage: text("error_message"),
    submittedAt: ts("submitted_at"),
  },
  (t) => ({
    userIdx: index("submissions_user_idx").on(t.userId),
    problemIdx: index("submissions_problem_idx").on(t.problemId),
    statusIdx: index("submissions_status_idx").on(t.status),
    userProblemLeetcodeSubmissionIdx: uniqueIndex("submissions_user_problem_lc_submission_unique").on(
      t.userId,
      t.problemId,
      t.leetcodeSubmissionId,
    ),
    // Cross-problem identity checks look a LeetCode submission id up per user.
    userLeetcodeSubmissionIdx: index("submissions_user_lc_submission_idx").on(t.userId, t.leetcodeSubmissionId),
  }),
);

/* ────────────────────────────────────────────────────────────────────────────
 * practice_sessions
 * One tracked attempt at a problem on LeetCode. The server owns the lifecycle;
 * the extension reports observations. `is_open` holds the single open slot per
 * problem (active, or interrupted within 24 hours); a stale interrupted
 * session keeps its history but releases the slot. Sessions never write FSRS
 * state themselves: scheduling happens through session-linked review events.
 * ──────────────────────────────────────────────────────────────────────────── */
export const practiceSessions = sqliteTable(
  "practice_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    problemId: text("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    /** Idempotency key of the command that created the session. */
    requestId: text("request_id").notNull(),
    type: text("type", { enum: ["initial_learning", "scheduled_review", "voluntary_practice"] }).notNull(),
    reviewMethod: text("review_method", { enum: ["leetcode_full_solve"] })
      .notNull()
      .default("leetcode_full_solve"),
    reviewIntent: text("review_intent", { enum: ["due", "early", "none"] }).notNull(),
    status: text("status", { enum: ["active", "interrupted", "completed", "abandoned"] })
      .notNull()
      .default("active"),
    isOpen: integer("is_open", { mode: "boolean" }).notNull().default(true),
    outcome: text("outcome", { enum: ["accepted", "failed", "unknown"] }),
    /** Incremented by every persisted change. */
    revision: integer("revision").notNull().default(0),
    /** The problem's schedule revision when the session started. */
    scheduleRevisionAtStart: integer("schedule_revision_at_start").notNull(),
    ratingDisposition: text("rating_disposition", {
      enum: ["not_applicable", "pending", "deferred", "submitted", "dismissed", "expired", "superseded", "undone"],
    })
      .notNull()
      .default("not_applicable"),
    ratingExpiresAt: optTs("rating_expires_at"),
    sourceSite: text("source_site", { enum: ["leetcode.com"] }).notNull().default("leetcode.com"),
    /** LeetCode username the extension verified at start, when available. */
    sourceAccount: text("source_account"),
    /** Tab that currently controls the session, and its renewable lease. */
    ownerToken: text("owner_token"),
    ownerLeaseExpiresAt: optTs("owner_lease_expires_at"),
    /** Newest LeetCode submission id seen before the session started. */
    baselineState: text("baseline_state", { enum: ["pending", "established", "none", "unavailable"] })
      .notNull()
      .default("pending"),
    baselineSubmissionId: text("baseline_submission_id"),
    /** Worst LeetCode availability reported while tracking. */
    captureCompleteness: text("capture_completeness", { enum: ["complete", "partial", "unavailable"] })
      .notNull()
      .default("complete"),
    // Estimated foreground activity and observed (tracked) time. Committed
    // totals come from previous owners; owner totals are the current tab's
    // cumulative reports, merged with max() so replays cannot double count.
    activeMs: integer("active_ms").notNull().default(0),
    observedMs: integer("observed_ms").notNull().default(0),
    ownerActiveMs: integer("owner_active_ms").notNull().default(0),
    ownerObservedMs: integer("owner_observed_ms").notNull().default(0),
    startedAt: ts("started_at"),
    lastActivityAt: ts("last_activity_at"),
    /** Client-reported completion time, validated against the session window. */
    completedAt: optTs("completed_at"),
    /** The client time was missing or implausible and had to be clamped. */
    completedAtAdjusted: integer("completed_at_adjusted", { mode: "boolean" }).notNull().default(false),
    /** Server time the finish/abandon command arrived. */
    completionReceivedAt: optTs("completion_received_at"),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => ({
    userRequestIdx: uniqueIndex("practice_sessions_user_request_unique").on(t.userId, t.requestId),
    // Target of composite foreign keys that pin children to the same owner.
    ownerIdx: uniqueIndex("practice_sessions_id_owner_unique").on(t.id, t.userId, t.problemId),
    openSlotIdx: uniqueIndex("practice_sessions_user_problem_open_unique")
      .on(t.userId, t.problemId)
      .where(sql`${t.isOpen} = 1`),
    userStartedIdx: index("practice_sessions_user_started_idx").on(t.userId, t.startedAt, t.id),
    userProblemStartedIdx: index("practice_sessions_user_problem_started_idx").on(t.userId, t.problemId, t.startedAt),
    userRatingIdx: index("practice_sessions_user_rating_idx").on(t.userId, t.ratingDisposition, t.ratingExpiresAt),
  }),
);

/* ────────────────────────────────────────────────────────────────────────────
 * practice_session_submissions
 * Submission observations associated with a session. Kept apart from
 * `submissions` so a verdict seen in the list can be recorded even when
 * LeetCode does not return code details. A LeetCode submission id belongs to
 * at most one session per user and site.
 * ──────────────────────────────────────────────────────────────────────────── */
export const practiceSessionSubmissions = sqliteTable(
  "practice_session_submissions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    problemId: text("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    sourceSite: text("source_site", { enum: ["leetcode.com"] }).notNull().default("leetcode.com"),
    leetcodeSubmissionId: text("leetcode_submission_id"),
    /** Durable client id for an observation LeetCode reported without an id. */
    clientObservationId: text("client_observation_id"),
    submissionId: text("submission_id").references(() => submissions.id, { onDelete: "set null" }),
    verdict: text("verdict", {
      enum: [
        "Accepted",
        "Wrong Answer",
        "Time Limit Exceeded",
        "Memory Limit Exceeded",
        "Runtime Error",
        "Compile Error",
        "Other",
      ],
    }).notNull(),
    /** LeetCode's submission time, when known. */
    submittedAt: optTs("submitted_at"),
    firstObservedAt: ts("first_observed_at"),
    detailStatus: text("detail_status", { enum: ["complete", "pending", "unavailable", "capacity_blocked"] }).notNull(),
    /** `ambiguous` observations are kept for explicit association and excluded from evidence. */
    association: text("association", { enum: ["automatic", "ambiguous", "confirmed", "rejected"] }).notNull(),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => ({
    sessionOwnerFk: foreignKey({
      name: "practice_session_submissions_session_owner_fk",
      columns: [t.sessionId, t.userId, t.problemId],
      foreignColumns: [practiceSessions.id, practiceSessions.userId, practiceSessions.problemId],
    }).onDelete("cascade"),
    userSiteSubmissionIdx: uniqueIndex("practice_session_submissions_user_site_lc_unique")
      .on(t.userId, t.sourceSite, t.leetcodeSubmissionId)
      .where(sql`${t.leetcodeSubmissionId} IS NOT NULL`),
    userClientObservationIdx: uniqueIndex("practice_session_submissions_user_client_obs_unique")
      .on(t.userId, t.clientObservationId)
      .where(sql`${t.clientObservationId} IS NOT NULL`),
    sessionObservedIdx: index("practice_session_submissions_session_idx").on(t.sessionId, t.firstObservedAt),
    identityCheck: check(
      "practice_session_submissions_identity",
      sql`${t.leetcodeSubmissionId} IS NOT NULL OR ${t.clientObservationId} IS NOT NULL`,
    ),
  }),
);

/* ────────────────────────────────────────────────────────────────────────────
 * practice_session_commands
 * Idempotency records for session commands (start, resume, takeover, finish,
 * abandon, rating decisions). A replay with the same request id and payload
 * returns the stored response; a changed payload is a conflict. Heartbeats and
 * observations are idempotent by construction and are not recorded here.
 * ──────────────────────────────────────────────────────────────────────────── */
export const practiceSessionCommands = sqliteTable(
  "practice_session_commands",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => practiceSessions.id, { onDelete: "cascade" }),
    requestId: text("request_id").notNull(),
    command: text("command", {
      enum: ["start", "resume", "takeover", "finish", "abandon", "set_baseline", "defer_rating", "dismiss_rating", "rate"],
    }).notNull(),
    /** SHA-256 of the canonical command payload, excluding the request id. */
    payloadDigest: text("payload_digest").notNull(),
    response: text("response", { mode: "json" }).$type<unknown>().notNull(),
    createdAt: ts("created_at"),
  },
  (t) => ({
    userRequestIdx: uniqueIndex("practice_session_commands_user_request_unique").on(t.userId, t.requestId),
    sessionIdx: index("practice_session_commands_session_idx").on(t.sessionId),
  }),
);

/* ────────────────────────────────────────────────────────────────────────────
 * cards
 * Flash cards for a problem. Only question (front) and answer (back).
 * AI generation creates candidate rows; user confirms to ready.
 * ──────────────────────────────────────────────────────────────────────────── */
export const cards = sqliteTable(
  "cards",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    problemId: text("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    aiStatus: text("ai_status", { enum: ["candidate", "failed", "ready"] })
      .notNull()
      .default("ready"),
    errorMessage: text("error_message"),
    version: integer("version").notNull().default(1),
    createdAt: ts("created_at"),
    updatedAt: optTs("updated_at"),
  },
  (t) => ({
    userIdx: index("cards_user_idx").on(t.userId),
    problemIdx: index("cards_problem_idx").on(t.problemId),
    aiStatusIdx: index("cards_ai_status_idx").on(t.aiStatus),
    userStatusProblemIdx: index("cards_user_status_problem_idx").on(t.userId, t.aiStatus, t.problemId),
  }),
);

/* ────────────────────────────────────────────────────────────────────────────
 * review_events
 * Append-only event log. Every meaningful interaction lands here so the
 * dashboard can reconstruct review history and FSRS trajectories.
 * ──────────────────────────────────────────────────────────────────────────── */
export const reviewEvents = sqliteTable(
  "review_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    problemId: text("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    eventType: text("event_type", {
      enum: [
        "problem_captured",
        "card_created",
        "submission_imported",
        "self_recall_rated",
        "fsrs_scheduled",
      ],
    }).notNull(),

    fsrsRating: integer("fsrs_rating"),
    requestId: text("request_id"),
    undoneAt: optTs("undone_at"),

    cardId: text("card_id").references(() => cards.id, { onDelete: "set null" }),
    submissionId: text("submission_id").references(() => submissions.id, { onDelete: "set null" }),
    // Scheduling provenance for events written after migration 0021; older
    // events keep NULL. A session is deleted only with its problem or user,
    // which also deletes these events, so the reference needs no action.
    practiceSessionId: text("practice_session_id").references(() => practiceSessions.id),
    policyVersion: text("policy_version"),
    reviewMethod: text("review_method", { enum: ["self_recall", "leetcode_full_solve"] }),
    /** The problem's schedule revision produced by this event. */
    scheduleRevision: integer("schedule_revision"),

    fsrsStabilitySnap: real("fsrs_stability_snap"),
    fsrsDifficultySnap: real("fsrs_difficulty_snap"),
    fsrsRetrievabilitySnap: real("fsrs_retrievability_snap"),

    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    occurredAt: ts("occurred_at"),
  },
  (t) => ({
    userIdx: index("review_events_user_idx").on(t.userId),
    problemIdx: index("review_events_problem_idx").on(t.problemId),
    typeIdx: index("review_events_type_idx").on(t.eventType),
    occurredIdx: index("review_events_occurred_idx").on(t.occurredAt),
    userTypeOccurredIdx: index("review_events_user_type_occurred_idx").on(t.userId, t.eventType, t.occurredAt),
    userRequestIdx: uniqueIndex("review_events_user_request_unique").on(t.userId, t.requestId),
    // Exactly-once scheduling: a session gets at most one rating and one
    // initial scheduling event, even across replays and Undo.
    sessionSchedulingIdx: uniqueIndex("review_events_session_scheduling_unique")
      .on(t.practiceSessionId, t.eventType)
      .where(sql`${t.practiceSessionId} IS NOT NULL AND ${t.eventType} IN ('self_recall_rated', 'fsrs_scheduled')`),
  }),
);

/* ────────────────────────────────────────────────────────────────────────────
 * quiz_sessions
 * Per-problem review quiz sessions. V1 keeps quiz items and answers as JSON so
 * the feature can iterate without normalizing every quiz item into its own row.
 * ──────────────────────────────────────────────────────────────────────────── */
export const quizSessions = sqliteTable(
  "quiz_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    problemId: text("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["active", "completed", "archived"] })
      .notNull()
      .default("active"),
    itemsJson: text("items_json", { mode: "json" }).$type<QuizItem[]>().notNull(),
    answersJson: text("answers_json", { mode: "json" }).$type<QuizAnswer[]>().notNull().default(sql`(json('[]'))`),
    score: integer("score"),
    createdAt: ts("created_at"),
    updatedAt: optTs("updated_at"),
    completedAt: optTs("completed_at"),
  },
  (t) => ({
    userIdx: index("quiz_sessions_user_idx").on(t.userId),
    problemIdx: index("quiz_sessions_problem_idx").on(t.problemId),
    statusIdx: index("quiz_sessions_status_idx").on(t.status),
    currentSessionIdx: uniqueIndex("quiz_sessions_user_problem_current_unique")
      .on(t.userId, t.problemId)
      .where(sql`${t.status} <> 'archived'`),
  }),
);

/* ────────────────────────────────────────────────────────────────────────────
 * mistake_records
 * User-confirmed causes of failure (the Mistake Profile). Evidence is linked,
 * never copied: a record points at the submission, quiz answer, or review
 * rating it came from. The partial unique indexes make "one occurrence per
 * source and category" hold even across retries; dismissed rows don't count.
 * ──────────────────────────────────────────────────────────────────────────── */
export const mistakeRecords = sqliteTable(
  "mistake_records",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    problemId: text("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    primaryCategory: text("primary_category", {
      enum: [
        "approach",
        "invariant",
        "edge_case",
        "complexity",
        "implementation",
        "conceptual",
        "other",
      ],
    }).notNull(),
    secondaryTags: text("secondary_tags", { mode: "json" }).$type<string[]>().notNull().default(sql`(json('[]'))`),
    summary: text("summary"),
    nextStep: text("next_step"),
    sourceType: text("source_type", { enum: ["manual", "submission", "quiz_answer", "review"] }).notNull(),
    submissionId: text("submission_id").references(() => submissions.id, { onDelete: "set null" }),
    quizSessionId: text("quiz_session_id").references(() => quizSessions.id, { onDelete: "set null" }),
    // Item id inside quiz_sessions.items_json. Sessions are archived, not
    // deleted, so the reference stays resolvable.
    quizItemId: text("quiz_item_id"),
    reviewEventId: text("review_event_id").references(() => reviewEvents.id, { onDelete: "set null" }),
    status: text("status", { enum: ["candidate", "confirmed", "dismissed"] })
      .notNull()
      .default("confirmed"),
    origin: text("origin", { enum: ["user", "ai_suggested"] }).notNull().default("user"),
    requestId: text("request_id").notNull(),
    resolvedAt: optTs("resolved_at"),
    confirmedAt: optTs("confirmed_at"),
    dismissedAt: optTs("dismissed_at"),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => ({
    userRequestIdx: uniqueIndex("mistake_records_user_request_unique").on(t.userId, t.requestId),
    userStatusCreatedIdx: index("mistake_records_user_status_created_idx").on(t.userId, t.status, t.createdAt),
    userCategoryCreatedIdx: index("mistake_records_user_category_created_idx").on(
      t.userId,
      t.primaryCategory,
      t.createdAt,
    ),
    userProblemIdx: index("mistake_records_user_problem_idx").on(t.userId, t.problemId),
    submissionDedupIdx: uniqueIndex("mistake_records_submission_dedup_unique")
      .on(t.userId, t.submissionId, t.primaryCategory)
      .where(sql`${t.submissionId} IS NOT NULL AND ${t.status} <> 'dismissed'`),
    quizDedupIdx: uniqueIndex("mistake_records_quiz_dedup_unique")
      .on(t.userId, t.quizSessionId, t.quizItemId, t.primaryCategory)
      .where(sql`${t.quizSessionId} IS NOT NULL AND ${t.status} <> 'dismissed'`),
    reviewDedupIdx: uniqueIndex("mistake_records_review_dedup_unique")
      .on(t.userId, t.reviewEventId, t.primaryCategory)
      .where(sql`${t.reviewEventId} IS NOT NULL AND ${t.status} <> 'dismissed'`),
  }),
);

/* ────────────────────────────────────────────────────────────────────────────
 * ai_jobs
 * Durable source of truth for asynchronous Card / Quiz generation. Queue
 * messages contain only the job id; all ownership, inputs and results live in
 * this user-scoped table so delivery can safely be at-least-once.
 * ──────────────────────────────────────────────────────────────────────────── */
export type EncryptedJobInput = {
  v: 1;
  iv: string;
  ciphertext: string;
};

export const aiJobs = sqliteTable(
  "ai_jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    problemId: text("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["card", "quiz"] }).notNull(),
    action: text("action", {
      enum: [
        "card_generate",
        "card_followup",
        "quiz_generate",
        "quiz_regenerate",
        "quiz_next_batch",
      ],
    }).notNull(),
    status: text("status", {
      enum: ["queued", "running", "succeeded", "failed", "cancelled", "superseded"],
    })
      .notNull()
      .default("queued"),

    idempotencyKey: text("idempotency_key").notNull(),
    // Non-null only while the job owns a logical generation slot. Clearing it
    // on every terminal transition lets a later user action create a new job.
    activeDedupKey: text("active_dedup_key"),
    inputEnvelope: text("input_envelope", { mode: "json" }).$type<EncryptedJobInput>().notNull(),

    provider: text("provider", { enum: ["anthropic", "openai", "deepseek"] }).notNull(),
    model: text("model").notNull(),
    reasoningMode: text("reasoning_mode", { enum: ["fast", "thinking"] }).notNull(),
    generationLanguage: text("generation_language", { enum: ["en", "zh"] }).notNull(),

    expectedCardId: text("expected_card_id"),
    expectedCardVersion: integer("expected_card_version"),
    expectedQuizSessionId: text("expected_quiz_session_id"),

    attempt: integer("attempt").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAfter: ts("run_after"),
    workerId: text("worker_id"),
    leaseExpiresAt: optTs("lease_expires_at"),
    cancelRequestedAt: optTs("cancel_requested_at"),

    resultCardId: text("result_card_id").references(() => cards.id, { onDelete: "set null" }),
    resultQuizSessionId: text("result_quiz_session_id").references(() => quizSessions.id, {
      onDelete: "set null",
    }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),

    queuedAt: ts("queued_at"),
    startedAt: optTs("started_at"),
    finishedAt: optTs("finished_at"),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => ({
    userIdx: index("ai_jobs_user_idx").on(t.userId),
    userStatusCreatedIdx: index("ai_jobs_user_status_created_idx").on(t.userId, t.status, t.createdAt),
    statusRunAfterIdx: index("ai_jobs_status_run_after_idx").on(t.status, t.runAfter),
    problemStatusIdx: index("ai_jobs_problem_status_idx").on(t.problemId, t.status),
    userIdempotencyIdx: uniqueIndex("ai_jobs_user_idempotency_unique").on(t.userId, t.idempotencyKey),
    userActiveDedupIdx: uniqueIndex("ai_jobs_user_active_dedup_unique").on(t.userId, t.activeDedupKey),
    userRunningIdx: uniqueIndex("ai_jobs_user_running_unique")
      .on(t.userId)
      .where(sql`${t.status} = 'running'`),
  }),
);

/* ────────────────────────────────────────────────────────────────────────────
 * agent_sessions / agent_runs / agent_messages / agent_steps
 * Persistent Study Coach conversations. Page and problem context belong to
 * individual runs, so one session can continue across the entire web app.
 * ──────────────────────────────────────────────────────────────────────────── */
export const agentSessions = sqliteTable(
  "agent_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title"),
    status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
    runCount: integer("run_count").notNull().default(0),
    summaryText: text("summary_text"),
    summarizedRunCount: integer("summarized_run_count").notNull().default(0),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => ({
    userUpdatedIdx: index("agent_sessions_user_updated_idx").on(t.userId, t.updatedAt),
  }),
);

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    requestId: text("request_id").notNull(),
    status: text("status", { enum: ["running", "succeeded", "failed"] })
      .notNull()
      .default("running"),
    contextJson: text("context_json", { mode: "json" }).$type<AgentPageContext>().notNull(),
    provider: text("provider", { enum: ["anthropic", "openai", "deepseek"] }).notNull(),
    model: text("model").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    responseMessagesJson: text("response_messages_json", { mode: "json" }).$type<unknown[]>(),
    startedAt: ts("started_at"),
    finishedAt: optTs("finished_at"),
  },
  (t) => ({
    userRequestIdx: uniqueIndex("agent_runs_user_request_unique").on(t.userId, t.requestId),
    sessionStartedIdx: index("agent_runs_session_started_idx").on(t.sessionId, t.startedAt),
    sessionRunningIdx: uniqueIndex("agent_runs_session_running_unique")
      .on(t.sessionId)
      .where(sql`${t.status} = 'running'`),
  }),
);

export const agentMessages = sqliteTable(
  "agent_messages",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    createdAt: ts("created_at"),
  },
  (t) => ({
    sessionCreatedIdx: index("agent_messages_session_created_idx").on(t.sessionId, t.createdAt),
    runRoleIdx: uniqueIndex("agent_messages_run_role_unique").on(t.runId, t.role),
  }),
);

export const agentSteps = sqliteTable(
  "agent_steps",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    kind: text("kind", { enum: ["read", "navigation", "proposal"] }).notNull(),
    toolName: text("tool_name").notNull(),
    status: text("status", {
      enum: ["completed", "pending", "accepted", "dismissed", "failed"],
    }).notNull(),
    summary: text("summary").notNull(),
    navigationJson: text("navigation_json", { mode: "json" }).$type<AgentNavigation>(),
    proposalJson: text("proposal_json", { mode: "json" }).$type<AgentProposal>(),
    aiJobId: text("ai_job_id").references(() => aiJobs.id, { onDelete: "set null" }),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => ({
    runSequenceIdx: uniqueIndex("agent_steps_run_sequence_unique").on(t.runId, t.sequence),
    userStatusIdx: index("agent_steps_user_status_idx").on(t.userId, t.status),
  }),
);

/* ────────────────────────────────────────────────────────────────────────────
 * settings
 * Per-user k/v settings. Holds encrypted AI provider configuration, review
 * preferences, onboarding state, and other user-scoped application settings.
 * ──────────────────────────────────────────────────────────────────────────── */
export const settings = sqliteTable(
  "settings",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value", { mode: "json" }).$type<unknown>().notNull(),
    updatedAt: ts("updated_at"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.key] }),
    userIdx: index("settings_user_idx").on(t.userId),
  }),
);

/* ────────────────────────────────────────────────────────────────────────────
 * ai_credit_balances / ai_credit_ledger / credit_purchases
 * Hosted AI credits. Free starter credits keep their counter in `settings`;
 * purchased credits live in `ai_credit_balances`. Every spend, refund, and
 * purchase is written to the append-only ledger, whose unique
 * (reason, ref_type, ref_id) index makes each transition idempotent.
 * The ledger and purchases deliberately have no foreign key to `user`: they
 * are kept (with the former user id) after account deletion, which forfeits
 * the remaining balance.
 * ──────────────────────────────────────────────────────────────────────────── */
export const aiCreditBalances = sqliteTable(
  "ai_credit_balances",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    balance: integer("balance").notNull().default(0),
    updatedAt: ts("updated_at"),
  },
  (t) => ({
    balanceNonNegative: check("ai_credit_balances_balance_non_negative", sql`${t.balance} >= 0`),
  }),
);

export const aiCreditLedger = sqliteTable(
  "ai_credit_ledger",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    bucket: text("bucket", { enum: ["starter", "paid"] }).notNull(),
    /** Signed credit change for the bucket: negative for spends. */
    delta: integer("delta").notNull(),
    reason: text("reason", {
      enum: ["purchase", "spend", "refund", "stripe_refund", "forfeit", "adjustment"],
    }).notNull(),
    refType: text("ref_type", { enum: ["checkout_session", "ai_job", "agent_run", "account", "manual"] }).notNull(),
    refId: text("ref_id").notNull(),
    createdAt: ts("created_at"),
  },
  (t) => ({
    userCreatedIdx: index("ai_credit_ledger_user_created_idx").on(t.userId, t.createdAt),
    // Per bucket: one action can be paid partly from free and partly from
    // purchased credits, one row each. spendHostedCredit() still refuses a
    // second spend for the same work.
    refIdx: uniqueIndex("ai_credit_ledger_reason_ref_bucket_unique").on(t.reason, t.refType, t.refId, t.bucket),
  }),
);

export const creditPurchases = sqliteTable(
  "credit_purchases",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    stripeCheckoutSessionId: text("stripe_checkout_session_id").notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    packId: text("pack_id").notNull(),
    credits: integer("credits").notNull(),
    amountTotal: integer("amount_total").notNull(),
    currency: text("currency").notNull(),
    status: text("status", { enum: ["paid", "refunded"] }).notNull().default("paid"),
    createdAt: ts("created_at"),
    refundedAt: optTs("refunded_at"),
  },
  (t) => ({
    sessionIdx: uniqueIndex("credit_purchases_checkout_session_unique").on(t.stripeCheckoutSessionId),
    paymentIntentIdx: index("credit_purchases_payment_intent_idx").on(t.stripePaymentIntentId),
    userCreatedIdx: index("credit_purchases_user_created_idx").on(t.userId, t.createdAt),
  }),
);

export type Problem = typeof problems.$inferSelect;
export type NewProblem = typeof problems.$inferInsert;
export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;
export type Card = typeof cards.$inferSelect;
export type NewCard = typeof cards.$inferInsert;
export type PracticeSession = typeof practiceSessions.$inferSelect;
export type NewPracticeSession = typeof practiceSessions.$inferInsert;
export type PracticeSessionSubmission = typeof practiceSessionSubmissions.$inferSelect;
export type NewPracticeSessionSubmission = typeof practiceSessionSubmissions.$inferInsert;
export type PracticeSessionCommand = typeof practiceSessionCommands.$inferSelect;
export type ReviewEvent = typeof reviewEvents.$inferSelect;
export type NewReviewEvent = typeof reviewEvents.$inferInsert;
export type QuizSession = typeof quizSessions.$inferSelect;
export type NewQuizSession = typeof quizSessions.$inferInsert;
export type MistakeRecord = typeof mistakeRecords.$inferSelect;
export type NewMistakeRecord = typeof mistakeRecords.$inferInsert;
export type AiJob = typeof aiJobs.$inferSelect;
export type NewAiJob = typeof aiJobs.$inferInsert;
export type AgentSession = typeof agentSessions.$inferSelect;
export type NewAgentSession = typeof agentSessions.$inferInsert;
export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;
export type AgentMessage = typeof agentMessages.$inferSelect;
export type NewAgentMessage = typeof agentMessages.$inferInsert;
export type AgentStep = typeof agentSteps.$inferSelect;
export type NewAgentStep = typeof agentSteps.$inferInsert;
export type SettingRow = typeof settings.$inferSelect;
export type AiCreditLedgerEntry = typeof aiCreditLedger.$inferSelect;
export type CreditPurchase = typeof creditPurchases.$inferSelect;
export type User = typeof user.$inferSelect;
export type Session = typeof session.$inferSelect;
export type Account = typeof account.$inferSelect;
export type Verification = typeof verification.$inferSelect;

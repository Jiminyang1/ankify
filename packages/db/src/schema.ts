import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";

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

export const apikey = sqliteTable(
  "apikey",
  {
    id: text("id").primaryKey(),
    configId: text("config_id").notNull().default("default"),
    name: text("name"),
    start: text("start"),
    referenceId: text("reference_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    prefix: text("prefix"),
    key: text("key").notNull(),
    refillInterval: integer("refill_interval"),
    refillAmount: integer("refill_amount"),
    lastRefillAt: optTs("last_refill_at"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    rateLimitEnabled: integer("rate_limit_enabled", { mode: "boolean" }).notNull().default(true),
    rateLimitTimeWindow: integer("rate_limit_time_window").notNull().default(86_400_000),
    rateLimitMax: integer("rate_limit_max").notNull().default(1000),
    requestCount: integer("request_count").notNull().default(0),
    remaining: integer("remaining"),
    lastRequest: optTs("last_request"),
    expiresAt: optTs("expires_at"),
    permissions: text("permissions"),
    metadata: text("metadata"),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => ({
    referenceIdx: index("apikey_reference_idx").on(t.referenceId),
    keyIdx: uniqueIndex("apikey_key_unique").on(t.key),
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
    fsrsReps: integer("fsrs_reps").notNull().default(0),
    fsrsLapses: integer("fsrs_lapses").notNull().default(0),
    fsrsState: text("fsrs_state", { enum: ["new", "learning", "review", "relearning"] })
      .notNull()
      .default("new"),
    fsrsLastReview: optTs("fsrs_last_review"),

    archivedAt: optTs("archived_at"),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => ({
    userIdx: index("problems_user_idx").on(t.userId),
    dueIdx: index("problems_fsrs_due_idx").on(t.fsrsDue),
    slugIdx: index("problems_slug_idx").on(t.leetcodeSlug),
    userArchivedDueIdx: index("problems_user_archived_due_idx").on(t.userId, t.archivedAt, t.fsrsDue),
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

    cardId: text("card_id").references(() => cards.id, { onDelete: "set null" }),
    submissionId: text("submission_id").references(() => submissions.id, { onDelete: "set null" }),

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
  }),
);

/* ────────────────────────────────────────────────────────────────────────────
 * quiz_sessions
 * Per-problem review quiz sessions. V1 keeps quiz items and answers as JSON so
 * the feature can iterate without normalizing every quiz item into its own row.
 * ──────────────────────────────────────────────────────────────────────────── */
export type QuizItem = {
  id: string;
  question: string;
  choices: string[];
  answerIndex: number;
  explanation: string;
  source: "statement" | "submission" | "notes" | "card";
  scope: "approach" | "invariant" | "edge_case" | "complexity" | "implementation" | "mistake_review";
};

export type QuizAnswer = {
  itemId: string;
  selectedIndex: number;
  correct: boolean;
  answeredAt: string;
};

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
  }),
);

/* ────────────────────────────────────────────────────────────────────────────
 * settings
 * Single-row k/v table for V1 (single user, no auth). Holds AI provider choice,
 * API keys (if user prefers DB-stored over env), FSRS params, etc.
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

export type Problem = typeof problems.$inferSelect;
export type NewProblem = typeof problems.$inferInsert;
export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;
export type Card = typeof cards.$inferSelect;
export type NewCard = typeof cards.$inferInsert;
export type ReviewEvent = typeof reviewEvents.$inferSelect;
export type NewReviewEvent = typeof reviewEvents.$inferInsert;
export type QuizSession = typeof quizSessions.$inferSelect;
export type NewQuizSession = typeof quizSessions.$inferInsert;
export type SettingRow = typeof settings.$inferSelect;
export type User = typeof user.$inferSelect;
export type Session = typeof session.$inferSelect;
export type Account = typeof account.$inferSelect;
export type Verification = typeof verification.$inferSelect;
export type ApiKey = typeof apikey.$inferSelect;

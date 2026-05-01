import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

const ts = (name: string) =>
  integer(name, { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`);

const optTs = (name: string) => integer(name, { mode: "timestamp_ms" });

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
    leetcodeSlug: text("leetcode_slug").notNull().unique(),
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
    dueIdx: index("problems_fsrs_due_idx").on(t.fsrsDue),
    slugIdx: index("problems_slug_idx").on(t.leetcodeSlug),
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
    problemId: text("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
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
    problemIdx: index("submissions_problem_idx").on(t.problemId),
    statusIdx: index("submissions_status_idx").on(t.status),
  }),
);

/* ────────────────────────────────────────────────────────────────────────────
 * cards
 * Flash cards for a problem. Only question (front) and answer (back).
 * AI generation creates generating rows, then candidate rows; user confirms to ready.
 * ──────────────────────────────────────────────────────────────────────────── */
export const cards = sqliteTable(
  "cards",
  {
    id: text("id").primaryKey(),
    problemId: text("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    aiStatus: text("ai_status", { enum: ["generating", "candidate", "failed", "ready"] })
      .notNull()
      .default("ready"),
    errorMessage: text("error_message"),
    createdAt: ts("created_at"),
  },
  (t) => ({
    problemIdx: index("cards_problem_idx").on(t.problemId),
    aiStatusIdx: index("cards_ai_status_idx").on(t.aiStatus),
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
    problemId: text("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    eventType: text("event_type", {
      enum: [
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
    problemIdx: index("review_events_problem_idx").on(t.problemId),
    typeIdx: index("review_events_type_idx").on(t.eventType),
    occurredIdx: index("review_events_occurred_idx").on(t.occurredAt),
  }),
);

/* ────────────────────────────────────────────────────────────────────────────
 * settings
 * Single-row k/v table for V1 (single user, no auth). Holds AI provider choice,
 * API keys (if user prefers DB-stored over env), FSRS params, etc.
 * ──────────────────────────────────────────────────────────────────────────── */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<unknown>().notNull(),
  updatedAt: ts("updated_at"),
});

export type Problem = typeof problems.$inferSelect;
export type NewProblem = typeof problems.$inferInsert;
export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;
export type Card = typeof cards.$inferSelect;
export type NewCard = typeof cards.$inferInsert;
export type ReviewEvent = typeof reviewEvents.$inferSelect;
export type NewReviewEvent = typeof reviewEvents.$inferInsert;
export type SettingRow = typeof settings.$inferSelect;

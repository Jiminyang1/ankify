import type { SkillDimension } from "../skills";
import type { FsrsRating, LeetCodeDifficulty } from "../types";
import type { FeedParams } from "./params";

export type FeedItemKind = "quiz_retry" | "problem_drill" | "new_problem";
/** `weak`: slot given to a weak dimension. `checkup`: recovered, exploration, or cold-start slot. */
export type FeedLane = "weak" | "checkup";
export type FeedOutcome = "clean" | "shaky" | "failed" | "correct" | "incorrect";

type EvidenceBase = {
  at: Date;
  /** Owned problem the evidence is about; null for an unseen (new) problem. */
  problemId: string | null;
  topics: readonly string[];
};

/** Raw evidence; the engine turns it into fail/pass weights (FEED_PARAMS.weights). */
export type FeedEvidence =
  | (EvidenceBase & { kind: "mistake"; dimension: SkillDimension; resolved: boolean })
  | (EvidenceBase & { kind: "quiz_answer"; scope: string; correct: boolean })
  | (EvidenceBase & { kind: "review_rating"; rating: FsrsRating })
  | (EvidenceBase & { kind: "feed_outcome"; dimension: SkillDimension | null; outcome: FeedOutcome });

export type FeedSimilarQuestion = {
  slug: string;
  title: string | null;
  difficulty: LeetCodeDifficulty | null;
  paidOnly: boolean;
};

export type FeedProblem = {
  id: string;
  slug: string;
  title: string;
  difficulty: LeetCodeDifficulty;
  topics: readonly string[];
  /** FSRS due date; null means never reviewed (it is in the due queue). */
  due: Date | null;
  lastReview: Date | null;
  /** FSRS retrievability now, 0-1. */
  retrievability: number;
  lapses: number;
  archived: boolean;
  similar: readonly FeedSimilarQuestion[];
};

/** A quiz item the user answered wrong. */
export type FeedQuizMiss = {
  problemId: string;
  quizSessionId: string;
  quizItemId: string;
  scope: string;
  missedAt: Date;
};

/** A feed item from an earlier day. */
export type FeedHistoryItem = {
  dateKey: string;
  lane: FeedLane;
  kind: FeedItemKind;
  dimension: SkillDimension | null;
  problemId: string | null;
  targetSlug: string | null;
  quizSessionId: string | null;
  quizItemId: string | null;
  status: "pending" | "done" | "skipped";
  outcome: FeedOutcome | null;
};

export type FeedSettings = {
  /** Items per day, 0-5; 0 turns the feed off. */
  dailyItems: number;
  includeNewProblems: boolean;
};

export type DailyFeedInput = {
  /** Stable per user (e.g. the user id); combined with `dateKey` for all tie-breaks. */
  seed: string;
  /** The user's local date, `YYYY-MM-DD`, in their review time zone. */
  dateKey: string;
  now: Date;
  settings: FeedSettings;
  evidence: readonly FeedEvidence[];
  problems: readonly FeedProblem[];
  quizMisses: readonly FeedQuizMiss[];
  /** Feed items of earlier days (at least the last 30). Today's are ignored. */
  history: readonly FeedHistoryItem[];
  params?: FeedParams;
};

export type FeedReason =
  | { code: "recorded_mistakes"; dimension: SkillDimension; count: number; topic: string | null }
  | { code: "quiz_accuracy"; dimension: SkillDimension; correct: number; total: number }
  | { code: "missed_quiz"; missedAt: string }
  | { code: "similar_to"; problemId: string; title: string }
  | { code: "forgetting_risk"; retrievability: number }
  | { code: "checkup"; dimension: SkillDimension }
  | { code: "explore"; dimension: SkillDimension }
  | { code: "topic_weakness"; topic: string };

export type FeedPlanItem = {
  slot: number;
  lane: FeedLane;
  kind: FeedItemKind;
  dimension: SkillDimension | null;
  /** The owned problem to practice; for `new_problem`, the problem it is similar to. */
  problemId: string | null;
  /** The unseen problem, for `new_problem` only. */
  target: { slug: string; title: string | null; difficulty: LeetCodeDifficulty | null } | null;
  /** The quiz item to re-ask, for `quiz_retry` only. */
  quiz: { sessionId: string; itemId: string } | null;
  reasons: FeedReason[];
};

export type DimensionWeakness = {
  dimension: SkillDimension;
  /** Decayed fail and pass weight. */
  fail: number;
  pass: number;
  /** Beta-smoothed failure rate. */
  rate: number;
  confidence: number;
  weakness: number;
  weak: boolean;
  /** Weak within `recoveredWindowDays`, not weak now. */
  recovered: boolean;
  /** Unresolved confirmed mistakes in the evidence window. */
  recordedMistakes: number;
  quizCorrect: number;
  quizTotal: number;
};

export type TopicWeakness = { topic: string; weakness: number };

export type DailyFeedPlan = {
  items: FeedPlanItem[];
  dimensions: DimensionWeakness[];
  topics: TopicWeakness[];
};

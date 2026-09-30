import type { SkillDimension } from "../skills";
import type { LeetCodeDifficulty } from "../types";

/** A problem that could be suggested, with LeetCode metadata as last read. */
export type SuggestionCandidate = {
  slug: string;
  title: string;
  difficulty: LeetCodeDifficulty;
  paidOnly: boolean;
  /** Empty when the source carried no topics (similar questions). */
  topicTags: readonly string[];
  /** When the metadata was read from LeetCode; null means unverified. */
  verifiedAt: Date | null;
};

/** A problem the user practiced: its similar questions are candidates. */
export type SuggestionProblem = {
  id: string;
  title: string;
  difficulty: LeetCodeDifficulty;
  topics: readonly string[];
  similarSlugs: readonly string[];
  /** Confirmed mistake contexts on this problem in the profile window. */
  confirmedContexts: Partial<Record<SkillDimension, number>>;
};

/** An earlier suggestion. */
export type SuggestionHistoryItem = {
  dateKey: string;
  slug: string;
  category: SkillDimension | null;
  /** Still offered (not started, skipped, or marked attempted). */
  pending: boolean;
};

export type SuggestionPlanInput = {
  /** Stable per user; combined with the date, ordinal, and planner version. */
  seed: string;
  /** The user's local date, `YYYY-MM-DD`. */
  dateKey: string;
  /** Which of the day's suggestions this is (0 is the daily one). */
  ordinal: number;
  profile: {
    /** Enough completed sessions across problems to personalize. */
    personalized: boolean;
    categories: readonly { category: SkillDimension; weakness: number; weak: boolean; ready: boolean; contexts: number }[];
    /** Completed sessions per topic in the profile window. */
    topics: readonly { topic: string; sessions: number }[];
  };
  problems: readonly SuggestionProblem[];
  candidates: readonly SuggestionCandidate[];
  /** Every slug known to be attempted: problem rows and attempt history. */
  attempted: ReadonlySet<string>;
  /** Earlier suggestions: at least the exposure window, and every pending one. */
  history: readonly SuggestionHistoryItem[];
  /** Difficulties of recently practiced problems, newest first. */
  recentDifficulties: readonly LeetCodeDifficulty[];
};

/** Why a general-practice suggestion was not targeted at a weakness. */
export type GeneralPracticeWhy =
  /** Not enough completed sessions yet. */
  | "not_personalized"
  /** No dimension is both weak and confirmed across problems. */
  | "no_focus"
  /** The rotation's share for general practice. */
  | "rotation"
  /** A weak dimension exists, but no eligible problem fits it. */
  | "no_targeted_candidate";

/** Explanations; each states only what the stored metadata shows. */
export type SuggestionReason =
  | { code: "category_focus"; category: SkillDimension; contexts: number }
  /** LeetCode lists the target as similar to this practiced problem (on which
   *  the user confirmed a mistake of `category`, when set). */
  | { code: "similar_to"; problemId: string; title: string; category: SkillDimension | null }
  | { code: "topic_match"; topic: string }
  | { code: "general_practice"; why: GeneralPracticeWhy };

export type SuggestionPlan =
  | {
      kind: "suggestion";
      target: { slug: string; title: string; difficulty: LeetCodeDifficulty; topicTags: string[] };
      /** The dimension it targets; null for general practice. */
      category: SkillDimension | null;
      lane: "personalized" | "general";
      reasons: SuggestionReason[];
      plannerVersion: string;
    }
  | { kind: "none"; reason: "no_candidates" };

import { retrievability, type FsrsCardState } from "./fsrs";
import { STUDY_PLAN_DATA } from "./study-plans.generated";
import type { LeetCodeDifficulty } from "./types";

/**
 * LeetCode's official study plans, used as the profile's learning path: each
 * group is one pattern in LeetCode's own order, and its questions are the
 * denominator for that pattern's progress. The data is a snapshot
 * (`pnpm plans:sync`), so nothing here calls LeetCode.
 */

export interface StudyPlanQuestion {
  id: number;
  slug: string;
  title: string;
  difficulty: LeetCodeDifficulty;
}

export interface StudyPlanGroup {
  name: string;
  questions: StudyPlanQuestion[];
}

export interface StudyPlan {
  slug: string;
  name: string;
  groups: StudyPlanGroup[];
}

export const STUDY_PLANS: readonly StudyPlan[] = STUDY_PLAN_DATA;
export const DEFAULT_STUDY_PLAN = "top-interview-150";

export function getStudyPlan(slug: unknown): StudyPlan {
  return (
    STUDY_PLANS.find((plan) => plan.slug === slug) ??
    STUDY_PLANS.find((plan) => plan.slug === DEFAULT_STUDY_PLAN)!
  );
}

/**
 * - `mastered`: in the deck, reviewed, still recalled, and stable for 3+ weeks
 * - `learning`: in the deck but not yet stable (includes never-reviewed)
 * - `fading`: in the deck and recall has dropped below 70%
 * - `solved`: solved on LeetCode or archived, but not being reviewed
 * - `todo`: no sign the user has solved it
 */
export type PlanProblemStatus = "mastered" | "learning" | "fading" | "solved" | "todo";

/** Stability, in days, from which a recalled problem counts as mastered. */
export const MASTERED_STABILITY_DAYS = 21;
/** Below this recall a tracked problem is fading. Matches the analysis page. */
export const FADING_RECALL = 0.7;

export function planProblemStatus(
  input: { tracked?: { fsrs: FsrsCardState; archived: boolean }; solvedOnLeetcode: boolean },
  now = new Date(),
): PlanProblemStatus {
  const { tracked } = input;
  if (tracked && !tracked.archived) {
    if (tracked.fsrs.reps === 0) return "learning";
    if (retrievability(tracked.fsrs, now) < FADING_RECALL) return "fading";
    return (tracked.fsrs.stability ?? 0) >= MASTERED_STABILITY_DAYS ? "mastered" : "learning";
  }
  return tracked || input.solvedOnLeetcode ? "solved" : "todo";
}

import { STUDY_PLAN_DATA } from "./study-plans.generated";
import type { LeetCodeDifficulty } from "./types";

/**
 * LeetCode's Top Interview 150 study plan, used as the profile's roadmap:
 * each group is one pattern and its questions are that pattern's
 * denominator. The data is a snapshot (`pnpm plans:sync`), so nothing here
 * calls LeetCode.
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

export const STUDY_PLAN: StudyPlan = STUDY_PLAN_DATA.find((plan) => plan.slug === "top-interview-150")!;

/**
 * Two questions per problem, four answers:
 * - did you solve it? (LeetCode) → `todo` or `solved`
 * - if it's in your ankify reviews, is it due? → `remembered` or `due`
 *
 * `solved` means solved on LeetCode (or archived in ankify) but not being
 * reviewed. FSRS's finer states stay internal; users see only these four.
 */
export type PlanProblemStatus = "todo" | "solved" | "remembered" | "due";

export function planProblemStatus(
  input: { tracked?: { due: Date | null; archived: boolean }; solvedOnLeetcode: boolean },
  now = new Date(),
): PlanProblemStatus {
  const { tracked } = input;
  if (tracked && !tracked.archived) {
    return tracked.due == null || tracked.due <= now ? "due" : "remembered";
  }
  return tracked || input.solvedOnLeetcode ? "solved" : "todo";
}

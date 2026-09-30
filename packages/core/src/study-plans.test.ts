import { describe, expect, it } from "vitest";
import { emptyCardState, type FsrsCardState } from "./fsrs";
import { DEFAULT_STUDY_PLAN, STUDY_PLANS, getStudyPlan, planProblemStatus } from "./study-plans";

const now = new Date("2026-09-29T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function reviewed(stability: number, daysSinceReview = 0): FsrsCardState {
  const lastReview = new Date(now.getTime() - daysSinceReview * DAY);
  return {
    due: new Date(lastReview.getTime() + stability * DAY),
    stability,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: stability,
    learningSteps: 0,
    reps: 3,
    lapses: 0,
    state: "review",
    lastReview,
  };
}

describe("study plan snapshot", () => {
  it("ships the three plans with unique questions per plan", () => {
    expect(STUDY_PLANS.map((plan) => plan.slug)).toEqual(["top-interview-150", "leetcode-75", "top-100-liked"]);
    for (const plan of STUDY_PLANS) {
      const slugs = plan.groups.flatMap((group) => group.questions.map((q) => q.slug));
      expect(new Set(slugs).size).toBe(slugs.length);
      expect(plan.groups.every((group) => group.questions.length > 0)).toBe(true);
    }
  });

  it("falls back to the default plan", () => {
    expect(getStudyPlan("nope").slug).toBe(DEFAULT_STUDY_PLAN);
    expect(getStudyPlan("leetcode-75").slug).toBe("leetcode-75");
  });
});

describe("planProblemStatus", () => {
  it("is todo without any evidence, solved with LeetCode evidence only", () => {
    expect(planProblemStatus({ solvedOnLeetcode: false }, now)).toBe("todo");
    expect(planProblemStatus({ solvedOnLeetcode: true }, now)).toBe("solved");
  });

  it("reads tracked problems from FSRS", () => {
    const track = (fsrs: FsrsCardState) => planProblemStatus({ tracked: { fsrs, archived: false }, solvedOnLeetcode: false }, now);
    expect(track(emptyCardState(now))).toBe("learning");
    expect(track(reviewed(5))).toBe("learning");
    expect(track(reviewed(30))).toBe("mastered");
    expect(track(reviewed(2, 30))).toBe("fading");
  });

  it("treats archived problems as solved but not reviewed", () => {
    expect(planProblemStatus({ tracked: { fsrs: reviewed(30), archived: true }, solvedOnLeetcode: false }, now)).toBe("solved");
  });
});

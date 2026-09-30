import { describe, expect, it } from "vitest";
import { STUDY_PLAN, planProblemStatus } from "./study-plans";

const now = new Date("2026-09-29T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(now.getTime() + days * DAY);

describe("study plan snapshot", () => {
  it("is Top Interview 150 with unique, non-empty groups", () => {
    expect(STUDY_PLAN.slug).toBe("top-interview-150");
    const slugs = STUDY_PLAN.groups.flatMap((group) => group.questions.map((q) => q.slug));
    expect(slugs).toHaveLength(150);
    expect(new Set(slugs).size).toBe(150);
    expect(STUDY_PLAN.groups.every((group) => group.questions.length > 0)).toBe(true);
  });
});

describe("planProblemStatus", () => {
  it("is todo without any evidence, solved with LeetCode evidence only", () => {
    expect(planProblemStatus({ solvedOnLeetcode: false }, now)).toBe("todo");
    expect(planProblemStatus({ solvedOnLeetcode: true }, now)).toBe("solved");
  });

  it("splits reviewed problems by whether they are due", () => {
    const track = (due: Date | null) => planProblemStatus({ tracked: { due, archived: false }, solvedOnLeetcode: true }, now);
    expect(track(inDays(5))).toBe("remembered");
    expect(track(inDays(-1))).toBe("due");
    expect(track(now)).toBe("due");
    expect(track(null)).toBe("due");
  });

  it("treats archived problems as solved but not reviewed", () => {
    expect(planProblemStatus({ tracked: { due: inDays(-1), archived: true }, solvedOnLeetcode: false }, now)).toBe("solved");
  });
});

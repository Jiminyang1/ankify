import { describe, expect, it } from "vitest";
import { captureProblemSchema, leetcodeSlugSchema } from "./schemas";
import { attemptHistoryMergeSchema } from "./suggestions";

const problem = {
  leetcodeSlug: "two-sum",
  title: "Two Sum",
  difficulty: "Easy",
  url: "https://leetcode.com/problems/two-sum/",
};

describe("suggestion contracts", () => {
  it("accepts verified similar questions, and payloads from extensions that send none", () => {
    expect(captureProblemSchema.parse(problem).similarQuestions).toBeUndefined();
    const similar = { slug: "3sum", title: "3Sum", difficulty: "Medium", paidOnly: false };
    expect(captureProblemSchema.parse({ ...problem, similarQuestions: [similar] }).similarQuestions).toEqual([similar]);
    for (const invalid of [
      { ...similar, slug: "Three_Sum" },
      { ...similar, difficulty: "Unknown" },
      { ...similar, paidOnly: undefined },
      { ...similar, extra: true },
    ]) {
      expect(captureProblemSchema.safeParse({ ...problem, similarQuestions: [invalid] }).success).toBe(false);
    }
  });

  it("validates LeetCode slugs strictly", () => {
    for (const slug of ["two-sum", "3sum", "a"]) expect(leetcodeSlugSchema.safeParse(slug).success).toBe(true);
    for (const slug of ["", "Two-Sum", "two--sum", "-two", "two_sum", "two sum", "x".repeat(257)]) {
      expect(leetcodeSlugSchema.safeParse(slug).success).toBe(false);
    }
  });

  it("requires the LeetCode account for LeetCode history, and coverage only with it", () => {
    const entries = [{ slug: "two-sum", status: "accepted" }];
    expect(attemptHistoryMergeSchema.safeParse({ source: "leetcode_status", sourceAccount: "leet_user", entries }).success).toBe(true);
    expect(attemptHistoryMergeSchema.safeParse({ source: "leetcode_status", sourceAccount: null, entries }).success).toBe(false);
    expect(attemptHistoryMergeSchema.safeParse({ source: "user_marked", sourceAccount: null, entries }).success).toBe(true);
    const coverage = { scope: "problem_list_tried", read: 10, total: 10, complete: true };
    expect(attemptHistoryMergeSchema.safeParse({ source: "leetcode_status", sourceAccount: "leet_user", entries, coverage }).success).toBe(true);
    expect(attemptHistoryMergeSchema.safeParse({ source: "user_marked", sourceAccount: null, entries, coverage }).success).toBe(false);
    expect(attemptHistoryMergeSchema.safeParse({ source: "deleted_problem", sourceAccount: null, entries }).success).toBe(false);
    const tooMany = Array.from({ length: 501 }, (_, index) => ({ slug: `p-${index}`, status: "attempted" }));
    expect(attemptHistoryMergeSchema.safeParse({ source: "user_marked", sourceAccount: null, entries: tooMany }).success).toBe(false);
  });
});

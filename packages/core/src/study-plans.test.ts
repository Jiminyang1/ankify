import { describe, expect, it } from "vitest";
import {
  DEFAULT_STUDY_PLAN,
  OFFICIAL_STUDY_PLANS,
  deepDivePlanFor,
  findOfficialStudyPlan,
  groupByPattern,
  planProblemStatus,
} from "./study-plans";

const now = new Date("2026-09-29T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(now.getTime() + days * DAY);

describe("official study plans", () => {
  it("ships six plans with unique, non-empty groups", () => {
    expect(OFFICIAL_STUDY_PLANS.map((plan) => plan.slug)).toEqual([
      "top-interview-150",
      "leetcode-75",
      "top-100-liked",
      "dynamic-programming",
      "graph-theory",
      "binary-search",
    ]);
    for (const plan of OFFICIAL_STUDY_PLANS) {
      const slugs = plan.groups.flatMap((group) => group.questions.map((q) => q.slug));
      expect(new Set(slugs).size, plan.slug).toBe(slugs.length);
      expect(plan.groups.every((group) => group.questions.length > 0), plan.slug).toBe(true);
    }
  });

  it("finds plans by slug, including the default", () => {
    expect(findOfficialStudyPlan(DEFAULT_STUDY_PLAN)?.groups).toHaveLength(23);
    expect(findOfficialStudyPlan("nope")).toBeNull();
  });

  it("puts Top 100 Liked in learning order, not alphabetical", () => {
    const names = findOfficialStudyPlan("top-100-liked")!.groups.map((group) => group.name);
    expect(names[0]).toBe("Hashing");
    expect(names.at(-1)).toBe("Misc");
    expect(names).toHaveLength(15);
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

describe("groupByPattern", () => {
  const q = (slug: string, tagSlugs: string[]) => ({ id: 1, slug, title: slug, difficulty: "Medium" as const, tagSlugs });

  it("assigns the most specific technique and keeps learning order", () => {
    const groups = groupByPattern([
      q("coin-change", ["array", "dynamic-programming", "breadth-first-search"]),
      q("two-sum", ["array", "hash-table"]),
      q("word-search-ii", ["array", "string", "backtracking", "trie", "matrix"]),
      q("number-of-islands", ["array", "depth-first-search", "breadth-first-search", "union-find", "matrix"]),
      q("max-depth", ["tree", "depth-first-search", "breadth-first-search", "binary-tree"]),
      q("word-ladder", ["hash-table", "string", "breadth-first-search"]),
      q("valid-parentheses", ["string", "stack"]),
      q("mystery", ["brainteaser"]),
    ]);
    expect(groups.map((group) => [group.name, group.questions.map((question) => question.slug)])).toEqual([
      ["Arrays & Hashing", ["two-sum"]],
      ["Stack", ["valid-parentheses"]],
      ["Trees", ["max-depth"]],
      ["Tries", ["word-search-ii"]],
      ["Graphs", ["number-of-islands", "word-ladder"]],
      ["Dynamic Programming", ["coin-change"]],
      ["Other", ["mystery"]],
    ]);
  });
});

describe("deepDivePlanFor", () => {
  const dive = (group: string, plan = DEFAULT_STUDY_PLAN) => deepDivePlanFor(group, plan)?.slug ?? null;

  it("maps every plan's naming to the matching topic plan", () => {
    expect(["1D DP", "Multidimensional DP", "DP - 1D", "Dynamic Programming"].map((name) => dive(name))).toEqual(
      Array(4).fill("dynamic-programming"),
    );
    expect(["Graph General", "Graph BFS", "Graphs - DFS", "Graph", "Graphs"].map((name) => dive(name))).toEqual(
      Array(5).fill("graph-theory"),
    );
    expect(dive("Binary Search")).toBe("binary-search");
  });

  it("skips groups without a topic plan, and the plan you're already in", () => {
    expect(dive("Binary Search Tree")).toBeNull();
    expect(dive("Sliding Window")).toBeNull();
    expect(dive("Kadane's Algorithm")).toBeNull();
    expect(dive("Matrix Graphs", "graph-theory")).toBeNull();
  });

  it("links some group of every general official plan", () => {
    for (const slug of ["top-interview-150", "leetcode-75", "top-100-liked"]) {
      const plan = findOfficialStudyPlan(slug)!;
      const targets = new Set(plan.groups.map((group) => dive(group.name, slug)).filter(Boolean));
      expect(targets.size, slug).toBe(3);
    }
  });
});

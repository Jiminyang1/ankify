import { describe, expect, it } from "vitest";
import {
  PATTERN_ROUTE_SLUG,
  PATTERN_TOPICS,
  findPattern,
  patternStudyPlans,
  isMiscPattern,
  nextInPattern,
  patternProblem,
  patternSourceUrl,
  patternsForSlug,
} from "./patterns";

describe("pattern catalog", () => {
  it("ships the twelve lists with unique keys and known problems", () => {
    expect(PATTERN_TOPICS).toHaveLength(12);
    const keys = PATTERN_TOPICS.flatMap((topic) => topic.patterns.map((pattern) => pattern.key));
    expect(new Set(keys).size).toBe(keys.length);
    for (const topic of PATTERN_TOPICS) {
      for (const pattern of topic.patterns) {
        expect(pattern.key.startsWith(`${topic.key}/`), pattern.key).toBe(true);
        expect(pattern.problems.length, pattern.key).toBeGreaterThan(0);
        for (const [slug] of pattern.problems) expect(patternProblem(slug), slug).not.toBeNull();
      }
    }
  });

  it("links each topic to his list on leetcode.cn", () => {
    expect(patternSourceUrl(PATTERN_TOPICS[0]!)).toBe("https://leetcode.cn/circle/discuss/0viNMK/");
  });

  it("finds every pattern a problem is in", () => {
    const keys = patternsForSlug("binary-subarrays-with-sum").map(({ pattern }) => pattern.key);
    expect(keys).toContain("sliding-window/window-count-exact");
    expect(patternsForSlug("not-a-problem")).toEqual([]);
  });

  it("treats Other sections as miscellaneous", () => {
    expect(isMiscPattern({ zh: "不定长滑动窗口 / 其他" })).toBe(true);
    expect(isMiscPattern({ zh: "数学贪心 / 其他数学贪心" })).toBe(true);
    expect(isMiscPattern({ zh: "不定长滑动窗口 / 求子数组个数 / 恰好型滑动窗口" })).toBe(false);
  });
});

const pattern = {
  key: "t/p",
  zh: "p",
  en: "P",
  problems: [
    ["two-sum", 1100, "extension"],
    ["add-two-numbers", 1200, "core"],
    ["longest-substring-without-repeating-characters", 1300, "advanced"],
    ["median-of-two-sorted-arrays", 1400, "core"],
  ],
} as const;

describe("nextInPattern", () => {
  it("walks core, then advanced, then extensions, in list order", () => {
    const steps = nextInPattern(pattern, () => false, { limit: 4 });
    expect(steps.map((step) => step.slug)).toEqual([
      "add-two-numbers",
      "median-of-two-sorted-arrays",
      "longest-substring-without-repeating-characters",
      "two-sum",
    ]);
  });

  it("skips problems already done", () => {
    const done = new Set(["add-two-numbers", "median-of-two-sorted-arrays"]);
    const [next] = nextInPattern(pattern, (slug) => done.has(slug));
    expect(next?.slug).toBe("longest-substring-without-repeating-characters");
    expect(next).toMatchObject({ rating: 1300, tier: "advanced", title: expect.any(String) });
  });

  it("skips premium problems unless asked", () => {
    const real = findPattern("sliding-window/fixed-window")!.pattern;
    const premium = nextInPattern(real, () => false, { limit: 100, includePremium: true });
    const free = nextInPattern(real, () => false, { limit: 100 });
    expect(free.every((step) => !step.premium)).toBe(true);
    expect(premium.length).toBeGreaterThan(free.length);
  });
});

describe("patternStudyPlans", () => {
  const plans = patternStudyPlans("en");

  it("ships the Beginner Route first, then one plan per list", () => {
    expect(plans.map((plan) => plan.slug)).toEqual([
      PATTERN_ROUTE_SLUG,
      ...PATTERN_TOPICS.map((topic) => `ling:${topic.key}`),
    ]);
    expect(plans[0]!.groups.map((group) => group.name)).toEqual([
      "1. Sliding window",
      "2. Binary search",
      "3. Prefix sums, stacks, queues, heaps",
      "4. Binary tree DFS",
      "5. Grid DFS",
      "6. Backtracking",
      "7. Dynamic programming",
    ]);
  });

  it("keeps each plan's problems unique, free, and its groups non-empty and distinctly named", () => {
    for (const language of ["en", "zh"] as const) {
      for (const plan of patternStudyPlans(language)) {
        const slugs = plan.groups.flatMap((group) => group.questions.map((q) => q.slug));
        expect(new Set(slugs).size, plan.slug).toBe(slugs.length);
        expect(slugs.every((slug) => !patternProblem(slug)!.premium), plan.slug).toBe(true);
        expect(plan.groups.every((group) => group.questions.length > 0), plan.slug).toBe(true);
        const names = plan.groups.map((group) => group.name);
        expect(new Set(names).size, `${language} ${plan.slug}`).toBe(names.length);
      }
    }
  });

  it("caps the route by rating and points each stage at its list", () => {
    const route = plans[0]!;
    const window = findPattern("sliding-window/fixed-window")!.pattern;
    const rating = new Map(window.problems.map(([slug, value]) => [slug, value]));
    const stage = route.groups[0]!;
    expect(stage.deepDive).toBe("ling:sliding-window");
    for (const question of stage.questions) {
      if (rating.has(question.slug)) expect(rating.get(question.slug) ?? 0).toBeLessThanOrEqual(1700);
    }
  });

  it("names groups in Chinese with his headings", () => {
    const zh = patternStudyPlans("zh");
    expect(zh[0]!.name).toBe("灵神 · 新手村路线");
    const window = zh.find((plan) => plan.slug === "ling:sliding-window")!;
    expect(window.groups.map((group) => group.name)).toContain("恰好型滑动窗口");
    const trees = zh.find((plan) => plan.slug === "ling:trees")!.groups.map((group) => group.name);
    expect(trees).toContain("二叉树 · 有递有归");
    expect(trees).toContain("一般树 · 有递有归");
  });
});

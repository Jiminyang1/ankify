import { describe, expect, it } from "vitest";
import {
  PATTERN_TOPICS,
  findPattern,
  isMiscPattern,
  nextInPattern,
  patternProblem,
  patternSourceUrl,
  patternsForSlug,
  suggestSamePattern,
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

describe("suggestSamePattern", () => {
  it("suggests the first problem not done in the problem's pattern", () => {
    const suggestion = suggestSamePattern("binary-subarrays-with-sum", () => false);
    expect(suggestion?.pattern.key).toBe("sliding-window/window-count-exact");
    expect(suggestion?.next.slug).toBe("count-number-of-nice-subarrays");
  });

  it("skips muted patterns and finished ones", () => {
    const muted = new Set(["sliding-window/window-count-exact"]);
    const suggestion = suggestSamePattern("binary-subarrays-with-sum", () => false, muted);
    expect(suggestion?.pattern.key).not.toBe("sliding-window/window-count-exact");
    expect(suggestSamePattern("binary-subarrays-with-sum", () => true)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  PATTERN_ROUTE_SLUG,
  PATTERN_TOPICS,
  easierInTechnique,
  findPattern,
  focusPlanAfter,
  goDeeperInChapter,
  patternStudyPlans,
  isMiscPattern,
  nextInPattern,
  patternProblem,
  patternSourceUrl,
  patternsForSlug,
  techniquesForSlug,
  type Pattern,
  type PatternTopic,
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

/* ── One more of this technique ── */

const topicA = { key: "a", source: "srcA", zh: "甲", en: "A", patterns: [] } satisfies PatternTopic;
const topicB = { key: "b", source: "srcB", zh: "乙", en: "B", patterns: [] } satisfies PatternTopic;
const ladder = (key: string, zh: string, problems: Pattern["problems"]): Pattern => ({ key, zh, en: key, problems });

/** A tiny catalog: slug → its patterns. */
function catalog(entries: [PatternTopic, Pattern][]) {
  return (slug: string) =>
    entries
      .filter(([, pattern]) => pattern.problems.some(([candidate]) => candidate === slug))
      .map(([topic, pattern]) => ({ topic, pattern }));
}

describe("techniquesForSlug", () => {
  it("leaves out Other sections", () => {
    const lookup = catalog([
      [topicA, ladder("a/real", "甲 / 真", [["two-sum", null, "core"]])],
      [topicA, ladder("a/other", "甲 / 其他", [["two-sum", null, "core"]])],
    ]);
    expect(techniquesForSlug("two-sum", lookup).map(({ pattern }) => pattern.key)).toEqual(["a/real"]);
  });

  it("finds real techniques in the catalog", () => {
    expect(techniquesForSlug("longest-substring-without-repeating-characters").map(({ pattern }) => pattern.key)).toEqual([
      "sliding-window/window-longest",
    ]);
  });
});

describe("easierInTechnique", () => {
  const sliding = ladder("a/p", "甲 / p", [
    ["two-sum", null, "core"],
    ["add-two-numbers", 1200, "core"],
    ["palindrome-number", 1300, "advanced"],
    ["longest-substring-without-repeating-characters", 1500, "core"],
    ["median-of-two-sorted-arrays", 1600, "core"],
  ]);
  const lookup = catalog([[topicA, sliding]]);

  it("prefers a problem rated below the forgotten one", () => {
    const pick = easierInTechnique("longest-substring-without-repeating-characters", () => false, lookup);
    expect(pick?.step.slug).toBe("add-two-numbers");
    expect(pick?.pattern.key).toBe("a/p");
  });

  it("keeps core first among the lower-rated ones", () => {
    const pick = easierInTechnique(
      "longest-substring-without-repeating-characters",
      (slug) => slug === "add-two-numbers",
      lookup,
    );
    // The core problems left are unrated or rated higher, so the lower-rated
    // advanced one wins over them.
    expect(pick?.step.slug).toBe("palindrome-number");
  });

  it("falls back to the first problem not done when ratings don't help", () => {
    // two-sum has no rating, so nothing compares; the ladder's first open problem.
    expect(easierInTechnique("two-sum", () => false, lookup)?.step.slug).toBe("add-two-numbers");
    expect(
      easierInTechnique("add-two-numbers", (slug) => slug === "two-sum", lookup)?.step.slug,
    ).toBe("longest-substring-without-repeating-characters");
  });

  it("never suggests the problem itself or one already done", () => {
    const done = new Set(["two-sum", "add-two-numbers", "palindrome-number", "median-of-two-sorted-arrays"]);
    expect(easierInTechnique("longest-substring-without-repeating-characters", (slug) => done.has(slug), lookup)).toBeNull();
  });

  it("prefers a technique that has a lower-rated problem", () => {
    const flat = ladder("b/q", "乙 / q", [
      ["median-of-two-sorted-arrays", 1600, "core"],
      ["3sum", 1900, "core"],
    ]);
    const steep = ladder("a/r", "甲 / r", [
      ["valid-parentheses", 1100, "core"],
      ["median-of-two-sorted-arrays", 1600, "core"],
    ]);
    const pick = easierInTechnique("median-of-two-sorted-arrays", () => false, catalog([[topicB, flat], [topicA, steep]]));
    expect(pick?.step.slug).toBe("valid-parentheses");
    expect(pick?.topic.key).toBe("a");
  });

  it("is null outside the catalog", () => {
    expect(easierInTechnique("not-a-problem", () => false)).toBeNull();
  });
});

describe("goDeeperInChapter", () => {
  const common = ladder("a/common", "甲 / common", [
    ["two-sum", null, "core"],
    ["add-two-numbers", null, "core"],
    ["palindrome-number", 1300, "core"],
    ["container-with-most-water", 1400, "core"],
    ["3sum", 1500, "core"],
    ["valid-parentheses", 1600, "core"],
  ]);
  const rare = ladder("b/rare", "乙 / rare", [
    ["two-sum", null, "core"],
    ["merge-two-sorted-lists", null, "core"],
  ]);
  const lookup = catalog([[topicB, rare], [topicA, common]]);

  it("follows the technique most of the chapter uses", () => {
    const deeper = goDeeperInChapter(["two-sum", "add-two-numbers"], () => false, { lookup });
    expect(deeper?.pattern.key).toBe("a/common");
    expect(deeper?.steps.map((step) => step.slug)).toEqual(["palindrome-number", "container-with-most-water", "3sum"]);
  });

  it("skips problems done anywhere and honors the limit", () => {
    const deeper = goDeeperInChapter(["two-sum", "add-two-numbers"], (slug) => slug === "palindrome-number", {
      lookup,
      limit: 2,
    });
    expect(deeper?.steps.map((step) => step.slug)).toEqual(["container-with-most-water", "3sum"]);
  });

  it("breaks ties by chapter order and moves on when a ladder is done", () => {
    // Both techniques cover two-sum once: rare comes first in the catalog's
    // order for it.
    expect(goDeeperInChapter(["two-sum"], () => false, { lookup })?.pattern.key).toBe("b/rare");
    const deeper = goDeeperInChapter(["two-sum"], (slug) => slug === "merge-two-sorted-lists", { lookup });
    expect(deeper?.pattern.key).toBe("a/common");
  });

  it("is null when the chapter's problems are outside the catalog", () => {
    expect(goDeeperInChapter(["not-a-problem"], () => false)).toBeNull();
  });
});

describe("focusPlanAfter", () => {
  const window = findPattern("sliding-window/window-longest")!;
  const dp = findPattern("dp/house-robber")!;
  const lookup = catalog([
    [window.topic, window.pattern],
    [dp.topic, dp.pattern],
  ]);
  const slugIn = (pattern: Pattern) => pattern.problems[0]![0];

  it("picks the list whose problems are forgotten most", () => {
    const focus = focusPlanAfter({
      currentPlan: "top-interview-150",
      deck: [
        { slug: slugIn(window.pattern), lapses: 1 },
        { slug: slugIn(dp.pattern), lapses: 2 },
        { slug: dp.pattern.problems[1]![0], lapses: 1 },
      ],
      chapters: [],
      lookup,
    });
    expect(focus).toMatchObject({ kind: "topic", plan: "ling:dp", lapses: 3 });
  });

  it("never suggests the plan just finished", () => {
    const focus = focusPlanAfter({
      currentPlan: "ling:dp",
      deck: [
        { slug: slugIn(window.pattern), lapses: 1 },
        { slug: slugIn(dp.pattern), lapses: 5 },
      ],
      chapters: [],
      lookup,
    });
    expect(focus).toMatchObject({ kind: "topic", plan: "ling:sliding-window" });
  });

  it("falls back to the official deep dive for the chapter forgotten most", () => {
    const focus = focusPlanAfter({
      currentPlan: "top-interview-150",
      deck: [{ slug: "not-in-the-catalog", lapses: 4 }],
      chapters: [
        { name: "Hashmap", lapses: 1 },
        { name: "1D DP", lapses: 4 },
      ],
      lookup,
    });
    expect(focus).toEqual({ kind: "official", plan: "dynamic-programming", chapter: "1D DP", lapses: 4 });
  });

  it("suggests nothing without lapses", () => {
    expect(
      focusPlanAfter({
        currentPlan: "top-interview-150",
        deck: [{ slug: slugIn(dp.pattern), lapses: 0 }],
        chapters: [{ name: "1D DP", lapses: 0 }],
        lookup,
      }),
    ).toBeNull();
  });
});

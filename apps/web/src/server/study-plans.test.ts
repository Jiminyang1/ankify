import { describe, expect, it } from "vitest";
import { PATTERN_TOPICS } from "@ankify/core/patterns";
import { builtInPlanOptions, findBuiltInStudyPlan, lingSourceUrl, studyPlanSource } from "./study-plans";

describe("builtInPlanOptions", () => {
  it("lists plans in the map's order and categories", () => {
    const options = builtInPlanOptions("en");
    expect(options.map((option) => [option.slug, option.category])).toEqual([
      ["ling:course", "ling"],
      ["ling:route", "ling"],
      ["neetcode-150", "frequent"],
      ["neetcode-250", "frequent"],
      ["top-100-liked", "frequent"],
      ["top-interview-150", "frequent"],
      ["leetcode-75", "frequent"],
      ...PATTERN_TOPICS.map((topic) => [`ling:${topic.key}`, "dictionary"]),
      ["dynamic-programming", "dictionary"],
      ["graph-theory", "dictionary"],
      ["binary-search", "dictionary"],
    ]);
  });

  it("counts leetcode.cn-only problems only in Chinese", () => {
    const route = (language: "en" | "zh") => builtInPlanOptions(language).find((option) => option.slug === "ling:route")!;
    expect(route("zh")).toMatchObject({ name: "灵神 · 核心路线", problems: 459, chapters: 7 });
    expect(route("en")).toMatchObject({ name: "Ling Shen · Core Route", problems: 437, chapters: 7 });
  });
});

describe("studyPlanSource", () => {
  it("tells 灵茶山艾府's plans from NeetCode's, and LeetCode's have none", () => {
    expect(studyPlanSource("ling:sliding-window")).toEqual({
      url: "https://leetcode.cn/circle/discuss/0viNMK/",
      credit: "ling",
    });
    expect(studyPlanSource("neetcode-150")).toEqual({ url: "https://neetcode.io/practice", credit: "neetcode" });
    expect(studyPlanSource("top-interview-150")).toBeNull();
  });

  it("keeps NeetCode out of the field that credits him", () => {
    const options = builtInPlanOptions("en");
    expect(options.find((option) => option.slug === "neetcode-250")).toMatchObject({
      sourceUrl: null,
      source: { url: "https://neetcode.io/practice", credit: "neetcode" },
    });
    expect(lingSourceUrl(studyPlanSource("neetcode-250"))).toBeNull();
    expect(lingSourceUrl(studyPlanSource("ling:route"))).toContain("leetcode.cn");
  });

  it("finds the new plans by slug", () => {
    for (const slug of ["ling:course", "ling:route", "neetcode-150", "neetcode-250"]) {
      expect(findBuiltInStudyPlan(slug, "zh")?.slug).toBe(slug);
    }
  });
});

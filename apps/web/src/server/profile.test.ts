import { describe, expect, it } from "vitest";
import type { PlanProblemStatus } from "@ankify/core";
import { planNextFrom } from "./plan-next";
import type { PlanItem } from "./profile";

function item(slug: string, leetcodeId: number, status: PlanProblemStatus): PlanItem {
  return {
    slug,
    title: slug,
    difficulty: "Medium",
    leetcodeId,
    status,
    problemId: null,
    archived: false,
    due: null,
    lapses: 0,
  };
}

function group(name: string, items: PlanItem[]) {
  const counts: Record<PlanProblemStatus, number> = { todo: 0, solved: 0, remembered: 0, due: 0 };
  for (const entry of items) counts[entry.status] += 1;
  return { name, items, counts };
}

const plan = { slug: "top-interview-150", name: "Top Interview 150", sourceUrl: null };

describe("planNextFrom", () => {
  it("picks the first problem not started, in plan order, and its chapter", () => {
    const next = planNextFrom(plan, [
      group("Array / String", [item("merge-sorted-array", 88, "remembered"), item("remove-element", 27, "solved")]),
      group("Two Pointers", [
        item("valid-palindrome", 125, "due"),
        item("is-subsequence", 392, "todo"),
        item("two-sum-ii", 167, "todo"),
      ]),
    ]);
    expect(next).toEqual({
      plan: { ...plan, done: 3, total: 5 },
      next: {
        chapter: { name: "Two Pointers", done: 1, total: 3 },
        problem: { slug: "is-subsequence", leetcodeId: 392, title: "is-subsequence", difficulty: "Medium" },
      },
      // Two Pointers is already started, so this isn't the moment to go deeper.
      finishedChapter: null,
    });
  });

  it("offers going deeper on the chapter just finished until the next one starts", () => {
    const deeper = {
      technique: {
        key: "sliding-window/opposite-pointers",
        name: { en: "Opposite pointers", zh: "相向双指针" },
        topic: { key: "sliding-window", name: { en: "Sliding Window", zh: "滑动窗口" }, sourceUrl: "https://x/" },
      },
      problems: [],
    };
    const finished = { ...group("Two Pointers", [item("valid-palindrome", 125, "remembered")]), deeper };
    const fresh = planNextFrom(plan, [finished, group("Sliding Window", [item("minimum-size-subarray-sum", 209, "todo")])]);
    expect(fresh.finishedChapter).toEqual({ name: "Two Pointers", deeper });

    const started = planNextFrom(plan, [
      finished,
      group("Sliding Window", [item("longest-substring", 3, "solved"), item("minimum-size-subarray-sum", 209, "todo")]),
    ]);
    expect(started.finishedChapter).toBeNull();
  });

  it("keeps a skipped problem in an earlier chapter next", () => {
    const next = planNextFrom(plan, [
      group("Array / String", [item("merge-sorted-array", 88, "todo"), item("remove-element", 27, "solved")]),
      group("Two Pointers", [item("valid-palindrome", 125, "solved")]),
    ]);
    expect(next.next?.chapter).toEqual({ name: "Array / String", done: 1, total: 2 });
    expect(next.next?.problem.slug).toBe("merge-sorted-array");
  });

  it("says when every problem is solved", () => {
    const source = { slug: "ling:route", name: "灵神 · 新手村路线", sourceUrl: "https://leetcode.cn/circle/discuss/RvFUtj/" };
    expect(
      planNextFrom(source, [group("1. 滑动窗口", [item("a", 1, "solved"), item("b", 2, "remembered")])]),
    ).toEqual({ plan: { ...source, done: 2, total: 2 }, next: null });
  });
});

import { describe, expect, it } from "vitest";
import type { SkillDimension } from "../skills";
import { typeShares, type FeedTypeKey } from "./allocate";
import { FEED_PARAMS } from "./params";
import { planDailyFeed } from "./plan";
import {
  NOW,
  TODAY,
  daysFrom,
  feedInput,
  mistake,
  problem,
  quizAnswer,
  quizMiss,
  shiftDateKey,
} from "./test-fixtures";
import type { DailyFeedInput, FeedEvidence, FeedHistoryItem, FeedPlanItem, FeedProblem } from "./types";

const DP = ["Dynamic Programming"];
const ARRAY = ["Array"];
const TREE = ["Tree"];

function history(item: FeedPlanItem, dateKey: string): FeedHistoryItem {
  return {
    dateKey,
    lane: item.lane,
    kind: item.kind,
    dimension: item.dimension,
    problemId: item.problemId,
    targetSlug: item.target?.slug ?? null,
    quizSessionId: item.quiz?.sessionId ?? null,
    quizItemId: item.quiz?.itemId ?? null,
    status: "done",
    outcome: null,
  };
}

describe("planDailyFeed basics", () => {
  it("is empty when turned off, but still reports the weakness summary", () => {
    const dp1 = problem("dp1", { topics: DP });
    const plan = planDailyFeed(
      feedInput({ settings: { dailyItems: 0, includeNewProblems: true }, evidence: [mistake("invariant", dp1)], problems: [dp1] }),
    );
    expect(plan.items).toEqual([]);
    expect(plan.dimensions.find((d) => d.dimension === "invariant")?.weak).toBe(true);
  });

  it("is empty for a user with no evidence at all", () => {
    expect(planDailyFeed(feedInput({ problems: [problem("a"), problem("b")] })).items).toEqual([]);
  });

  it("starts cold from FSRS ratings with one topic drill and no dimension", () => {
    const tree1 = problem("tree1", { topics: TREE });
    const tree2 = problem("tree2", { topics: TREE, retrievability: 0.4 });
    const again: FeedEvidence = { kind: "review_rating", rating: 1, at: NOW, problemId: "tree1", topics: TREE };
    const plan = planDailyFeed(feedInput({ evidence: [again, again], problems: [tree1, tree2, problem("x")] }));
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]).toMatchObject({
      lane: "checkup",
      kind: "problem_drill",
      dimension: null,
      problemId: "tree2",
      reasons: [{ code: "topic_weakness", topic: "Tree" }, { code: "forgetting_risk", retrievability: 0.4 }],
    });
  });

  it("is deterministic for the same input", () => {
    const input = richInput();
    expect(planDailyFeed(input)).toEqual(planDailyFeed(input));
  });

  it("caps the number of items at five", () => {
    const input = richInput();
    expect(planDailyFeed({ ...input, settings: { dailyItems: 50, includeNewProblems: true } }).items).toHaveLength(5);
  });
});

describe("eligibility", () => {
  it("skips problems that are due soon, just reviewed, archived, new, or recently fed", () => {
    const eligible = problem("ok", { topics: DP });
    const problems: FeedProblem[] = [
      problem("due-soon", { topics: DP, due: daysFrom(NOW, 2) }),
      problem("just-reviewed", { topics: DP, lastReview: daysFrom(NOW, -1) }),
      problem("archived", { topics: DP, archived: true }),
      problem("never-reviewed", { topics: DP, due: null, lastReview: null }),
      problem("fed", { topics: DP, retrievability: 0 }),
      eligible,
    ];
    const fedEarlier: FeedHistoryItem = {
      ...history(
        { slot: 0, lane: "weak", kind: "problem_drill", dimension: "invariant", problemId: "fed", target: null, quiz: null, reasons: [] },
        shiftDateKey(TODAY, -3),
      ),
    };
    const plan = planDailyFeed(
      feedInput({
        settings: { dailyItems: 1, includeNewProblems: false },
        evidence: [mistake("invariant", problems[0]!)],
        problems,
        history: [fedEarlier],
      }),
    );
    expect(plan.items.map((item) => item.problemId)).toEqual(["ok"]);
  });

  it("returns nothing when no problem can be practiced", () => {
    const dp1 = problem("dp1", { topics: DP, due: daysFrom(NOW, 1) });
    const plan = planDailyFeed(feedInput({ evidence: [mistake("invariant", dp1)], problems: [dp1] }));
    expect(plan.items).toEqual([]);
  });

  it("falls back to a missed quiz item when no drill fits, and skips items answered right in the feed", () => {
    // Edge-case failures live in Array; the only Array problems are archived or
    // due soon, so no drill fits and the slot falls back to a quiz retry.
    const arr1 = problem("arr1", { topics: ARRAY, archived: true });
    const dueSoon = problem("arr2", { topics: ARRAY, due: daysFrom(NOW, 1) });
    const tree = problem("tree", { topics: TREE });
    const misses = [quizMiss(tree, "edge_case", "fresh", { daysAgo: 1 }), quizMiss(tree, "edge_case", "old"), quizMiss(tree, "edge_case", "retried")];
    const retried: FeedHistoryItem = {
      dateKey: shiftDateKey(TODAY, -10),
      lane: "weak",
      kind: "quiz_retry",
      dimension: "edge_case",
      problemId: "tree",
      targetSlug: null,
      quizSessionId: "session-tree",
      quizItemId: "retried",
      status: "done",
      outcome: "correct",
    };
    const plan = planDailyFeed(
      feedInput({
        settings: { dailyItems: 1, includeNewProblems: false },
        evidence: [mistake("edge_case", dueSoon), quizAnswer("edge_case", false, dueSoon)],
        problems: [arr1, dueSoon, tree],
        quizMisses: misses,
        history: [retried],
      }),
    );
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]).toMatchObject({
      kind: "quiz_retry",
      dimension: "edge_case",
      problemId: "tree",
      quiz: { sessionId: "session-tree", itemId: "old" },
    });
    expect(plan.items[0]!.reasons.map((r) => r.code)).toEqual(["recorded_mistakes", "quiz_accuracy", "missed_quiz"]);
  });
});

describe("new problems", () => {
  const parent = problem("dp1", {
    topics: DP,
    difficulty: "Medium",
    due: daysFrom(NOW, 1), // not drillable, so the slot goes to a new problem
    similar: [
      { slug: "premium", title: "Premium", difficulty: "Easy", paidOnly: true },
      { slug: "dp2", title: "Owned", difficulty: "Easy", paidOnly: false },
      { slug: "hard-one", title: "Hard one", difficulty: "Hard", paidOnly: false },
      { slug: "house-robber", title: "House Robber", difficulty: "Medium", paidOnly: false },
    ],
  });
  const owned = problem("dp2", { topics: DP, due: daysFrom(NOW, 1) });
  const base = feedInput({ evidence: [mistake("invariant", parent)], problems: [parent, owned] });

  it("suggests a free, unseen, not-harder similar question, at most one per day", () => {
    const plan = planDailyFeed(base);
    const fresh = plan.items.filter((item) => item.kind === "new_problem");
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toMatchObject({
      lane: "weak",
      dimension: "invariant",
      problemId: "dp1",
      target: { slug: "house-robber", title: "House Robber", difficulty: "Medium" },
    });
    expect(fresh[0]!.reasons).toContainEqual({ code: "similar_to", problemId: "dp1", title: "Problem dp1" });
  });

  it("does not repeat a suggestion within 30 days, and can be turned off", () => {
    const suggested: FeedHistoryItem = {
      dateKey: shiftDateKey(TODAY, -10),
      lane: "weak",
      kind: "new_problem",
      dimension: "invariant",
      problemId: "dp1",
      targetSlug: "house-robber",
      quizSessionId: null,
      quizItemId: null,
      status: "done",
      outcome: null,
    };
    expect(planDailyFeed({ ...base, history: [suggested] }).items.find((i) => i.kind === "new_problem")?.target?.slug).toBe(
      "hard-one",
    );
    expect(planDailyFeed({ ...base, settings: { dailyItems: 3, includeNewProblems: false } }).items).toEqual([]);
  });
});

describe("ordering", () => {
  it("puts quiz retries first and new problems last, interleaving dimensions", () => {
    const plan = planDailyFeed({ ...richInput(), settings: { dailyItems: 5, includeNewProblems: true } });
    const rank = { quiz_retry: 0, problem_drill: 1, new_problem: 2 } as const;
    const ranks = plan.items.map((item) => rank[item.kind]);
    expect(ranks).toEqual([...ranks].sort());
    expect(plan.items.map((item) => item.slot)).toEqual(plan.items.map((_, i) => i));
    // One item per practiced problem; a new problem is keyed by its own slug, not its parent.
    const keys = plan.items.map((item) => (item.kind === "new_problem" ? `new:${item.target!.slug}` : item.problemId));
    expect(new Set(keys).size).toBe(plan.items.length);
  });
});

/**
 * A deck with plenty of candidates for every dimension: DP (invariant), Array
 * (edge cases), and Tree (complexity) problems, missed quiz items, and similar
 * questions. Evidence is placed relative to `now`, so weakness stays constant
 * as the simulation advances day by day.
 */
function richDeck(now: Date) {
  const make = (prefix: string, topics: string[], count: number) =>
    Array.from({ length: count }, (_, i) =>
      problem(`${prefix}${i}`, {
        topics,
        retrievability: 0.5 + (i % 5) / 10,
        lapses: i % 3,
        similar: [0, 1, 2].map((j) => ({
          slug: `${prefix}${i}-similar-${j}`,
          title: `Similar ${prefix}${i}.${j}`,
          difficulty: "Medium" as const,
          paidOnly: false,
        })),
      }, now),
    );
  return { dp: make("dp", DP, 14), arr: make("arr", ARRAY, 14), tree: make("tree", TREE, 10) };
}

function richInput(now = NOW, dateKey = TODAY, weakTypes: 2 | 3 = 2): DailyFeedInput {
  const { dp, arr, tree } = richDeck(now);
  const evidence: FeedEvidence[] = [
    mistake("invariant", dp[0]!, { now }),
    mistake("invariant", dp[1]!, { now }),
    mistake("edge_case", arr[0]!, { now }),
    quizAnswer("edge_case", false, arr[1]!, { now }),
    ...(weakTypes === 3 ? [mistake("complexity", tree[0]!, { now })] : []),
  ];
  const quizMisses = [...dp, ...arr, ...tree].flatMap((p) => [
    quizMiss(p, p.topics[0] === "Dynamic Programming" ? "invariant" : p.topics[0] === "Array" ? "edge_case" : "complexity", `${p.id}-q`, { now }),
  ]);
  return feedInput({ now, dateKey, evidence, problems: [...dp, ...arr, ...tree], quizMisses });
}

function simulate(days: number, dailyItems: number, weakTypes: 2 | 3) {
  const log: { dateKey: string; items: FeedPlanItem[] }[] = [];
  const past: FeedHistoryItem[] = [];
  let expectedShares = new Map<FeedTypeKey, number>();
  for (let day = 0; day < days; day += 1) {
    const now = daysFrom(NOW, day);
    const dateKey = shiftDateKey(TODAY, day);
    const input = richInput(now, dateKey, weakTypes);
    const plan = planDailyFeed({ ...input, settings: { dailyItems, includeNewProblems: true }, history: [...past] });
    if (day === 0) {
      expectedShares = typeShares(
        new Map(plan.dimensions.filter((d) => d.weak).map((d) => [d.dimension, d.weakness] as [SkillDimension, number])),
        FEED_PARAMS,
      );
    }
    log.push({ dateKey, items: plan.items });
    past.push(...plan.items.map((item) => history(item, dateKey)));
  }
  return { log, expectedShares };
}

function typeOf(item: FeedPlanItem): FeedTypeKey {
  return item.lane === "checkup" ? "checkup" : item.dimension!;
}

describe("several weak types over time", () => {
  for (const weakTypes of [2, 3] as const) {
    it(`serves ${weakTypes} weak types in proportion, without starving or blocking any`, () => {
      const { log, expectedShares } = simulate(28, 3, weakTypes);
      expect(expectedShares.size).toBe(weakTypes + 1);

      const items = log.flatMap((day) => day.items);
      expect(items).toHaveLength(28 * 3);
      for (const [type, share] of expectedShares) {
        const served = items.filter((item) => typeOf(item) === type).length / items.length;
        expect(Math.abs(served - share)).toBeLessThan(0.1);
      }

      for (const day of log) {
        const perType = new Map<FeedTypeKey, number>();
        for (const item of day.items) perType.set(typeOf(item), (perType.get(typeOf(item)) ?? 0) + 1);
        expect(Math.max(...perType.values())).toBeLessThanOrEqual(2);
        expect(day.items.filter((item) => item.kind === "new_problem").length).toBeLessThanOrEqual(1);
      }

      for (const type of expectedShares.keys()) {
        if (type === "checkup") continue;
        const servedDays = log.flatMap((day, index) => (day.items.some((item) => typeOf(item) === type) ? [index] : []));
        const gaps = servedDays.slice(1).map((dayIndex, i) => dayIndex - servedDays[i]!);
        expect(servedDays[0]).toBeLessThanOrEqual(7);
        expect(Math.max(0, ...gaps)).toBeLessThanOrEqual(7);
      }
    });
  }

  it("rotates three weak types through a single daily slot", () => {
    const { log } = simulate(21, 1, 3);
    for (const dimension of ["invariant", "edge_case", "complexity"] as const) {
      const servedDays = log.flatMap((day, index) => (day.items.some((item) => item.dimension === dimension && item.lane === "weak") ? [index] : []));
      expect(servedDays.length).toBeGreaterThanOrEqual(4);
      const gaps = servedDays.slice(1).map((dayIndex, i) => dayIndex - servedDays[i]!);
      expect(Math.max(servedDays[0]!, ...gaps)).toBeLessThanOrEqual(7);
    }
  });

  it("mixes item kinds instead of drilling only", () => {
    const kinds = new Set(simulate(14, 3, 2).log.flatMap((day) => day.items.map((item) => item.kind)));
    expect(kinds).toEqual(new Set(["problem_drill", "quiz_retry", "new_problem"]));
  });
});

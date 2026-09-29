import { describe, expect, it } from "vitest";
import { FEED_PARAMS } from "./params";
import { NOW, TODAY, daysFrom, mistake, problem, quizAnswer, shiftDateKey } from "./test-fixtures";
import type { FeedEvidence, FeedHistoryItem } from "./types";
import { computeWeakness, daysBetweenKeys } from "./weakness";

const dp = problem("dp", { topics: ["Dynamic Programming"] });
const arr = problem("arr", { topics: ["Array", "Two Pointers"] });
const graph = problem("graph", { topics: ["Graph"] });

function model(evidence: FeedEvidence[], history: FeedHistoryItem[] = []) {
  return computeWeakness({ evidence, history, now: NOW, dateKey: TODAY, params: FEED_PARAMS });
}

function servedWeak(dimension: FeedHistoryItem["dimension"], daysAgo: number): FeedHistoryItem {
  return {
    dateKey: shiftDateKey(TODAY, -daysAgo),
    lane: "weak",
    kind: "problem_drill",
    dimension,
    problemId: "dp",
    targetSlug: null,
    quizSessionId: null,
    quizItemId: null,
    status: "done",
    outcome: null,
  };
}

describe("dimension weakness (worked values in docs/DAILY_FEED_PLAN.md)", () => {
  it("one confirmed mistake with no other evidence is weak (0.48)", () => {
    const invariant = model([mistake("invariant", dp)]).dimensions.get("invariant")!;
    expect(invariant.weakness).toBeCloseTo(0.48, 3);
    expect(invariant.weak).toBe(true);
    expect(invariant.recordedMistakes).toBe(1);
  });

  it("a single wrong answer in a 5-item quiz is not weak (0.155)", () => {
    const edge = model([
      quizAnswer("edge_case", false, arr),
      quizAnswer("approach", true, arr),
      quizAnswer("invariant", true, arr),
      quizAnswer("complexity", true, arr),
      quizAnswer("implementation", true, arr),
    ]).dimensions.get("edge_case")!;
    expect(edge.weakness).toBeCloseTo(0.1548, 3);
    expect(edge.weak).toBe(false);
    expect([edge.quizCorrect, edge.quizTotal]).toEqual([0, 1]);
  });

  it("two wrong edge_case answers in a 5-item quiz are weak (0.33)", () => {
    const edge = model([
      quizAnswer("edge_case", false, arr),
      quizAnswer("edge_case", false, arr),
      quizAnswer("approach", true, arr),
      quizAnswer("invariant", true, arr),
      quizAnswer("complexity", true, arr),
    ]).dimensions.get("edge_case")!;
    expect(edge.weakness).toBeCloseTo(0.3286, 3);
    expect(edge.weak).toBe(true);
  });

  it("an old mistake followed by two clean drills has recovered (0.126)", () => {
    const evidence: FeedEvidence[] = [
      mistake("invariant", dp, { daysAgo: 21 }),
      { kind: "feed_outcome", dimension: "invariant", outcome: "clean", at: NOW, problemId: "dp", topics: dp.topics },
      { kind: "feed_outcome", dimension: "invariant", outcome: "clean", at: NOW, problemId: "dp", topics: dp.topics },
    ];
    const invariant = model(evidence, [servedWeak("invariant", 3)]).dimensions.get("invariant")!;
    expect(invariant.weakness).toBeCloseTo(0.1261, 3);
    expect(invariant.weak).toBe(false);
    expect(invariant.recovered).toBe(true);
  });

  it("keeps a recently served dimension weak until it drops below the exit threshold", () => {
    // A resolved mistake counts 25 %: weakness ≈ 0.186, between exit (0.15) and enter (0.25).
    const evidence = [mistake("invariant", dp, { resolved: true })];
    expect(model(evidence).dimensions.get("invariant")!.weakness).toBeCloseTo(0.1855, 3);
    expect(model(evidence).dimensions.get("invariant")!.weak).toBe(false);
    expect(model(evidence, [servedWeak("invariant", 5)]).dimensions.get("invariant")!.weak).toBe(true);

    const stale = model(evidence, [servedWeak("invariant", 20)]).dimensions.get("invariant")!;
    expect(stale.weak).toBe(false);
    expect(stale.recovered).toBe(true);
  });

  it("ignores evidence older than 90 days and decays the rest", () => {
    expect(model([mistake("invariant", dp, { daysAgo: 91 })]).dimensions.get("invariant")!.fail).toBe(0);
    expect(model([mistake("invariant", dp, { daysAgo: 21 })]).dimensions.get("invariant")!.fail).toBeCloseTo(1.5, 6);
  });

  it("maps mistake_review answers and FSRS ratings to topics only", () => {
    const result = model([
      quizAnswer("mistake_review", false, graph),
      { kind: "review_rating", rating: 1, at: NOW, problemId: "graph", topics: graph.topics },
    ]);
    expect([...result.dimensions.values()].every((d) => d.fail === 0 && d.pass === 0)).toBe(true);
    expect(result.hasDimensionEvidence).toBe(false);
    expect(result.topics.get("Graph")).toBeGreaterThan(0.25);
  });

  it("splits a dimension's failures across a problem's topics and normalizes the shares", () => {
    const result = model([mistake("edge_case", arr), mistake("edge_case", dp)]);
    const shares = result.topicShare.get("edge_case")!;
    expect(shares.get("Dynamic Programming")).toBeCloseTo(0.5, 6);
    expect(shares.get("Array")).toBeCloseTo(0.25, 6);
    expect(shares.get("Two Pointers")).toBeCloseTo(0.25, 6);
    expect(result.problemFail.get("edge_case")!.get("arr")).toBeCloseTo(3, 6);
  });
});

describe("date keys", () => {
  it("counts whole days between local dates, across month ends", () => {
    expect(daysBetweenKeys("2026-09-28", "2026-10-02")).toBe(4);
    expect(daysBetweenKeys(TODAY, TODAY)).toBe(0);
    expect(() => daysBetweenKeys("2026-9-28", TODAY)).toThrow();
    expect(daysFrom(NOW, 1).getTime() - NOW.getTime()).toBe(86_400_000);
  });
});

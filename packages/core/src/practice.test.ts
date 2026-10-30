import { describe, expect, it } from "vitest";
import { questionOverlap, suggestPracticeRating } from "./practice";

describe("suggestPracticeRating", () => {
  it("maps the score to a rating, with Easy only for a perfect longer session", () => {
    expect(suggestPracticeRating(1, 6)).toBe(1);
    expect(suggestPracticeRating(3, 6)).toBe(2);
    expect(suggestPracticeRating(5, 6)).toBe(3);
    expect(suggestPracticeRating(6, 6)).toBe(4);
    expect(suggestPracticeRating(3, 3)).toBe(3);
  });
});

describe("questionOverlap", () => {
  it("measures overlap by shared words", () => {
    expect(questionOverlap("What does the hash map store?", "what does the HASH map store")).toBe(1);
    expect(questionOverlap("Time complexity?", "Which edge case breaks it?")).toBe(0);
  });
});

describe("talk-through targets and score", () => {
  const at = (days: number) => new Date(Date.UTC(2026, 9, 5) - days * 86_400_000);
  it("asks the approach first, then this problem's two most recent weak spots", async () => {
    const { selectPracticeTargets } = await import("./practice");
    const targets = selectPracticeTargets({
      problemWeaknesses: [
        { id: "a", category: "init_sentinel", detail: "dp starts at 0", lastSeenAt: at(5) },
        { id: "b", category: "efficiency", detail: "no memo, TLE", lastSeenAt: at(1) },
        { id: "c", category: "edge_cases", detail: "empty input", lastSeenAt: at(9) },
      ],
    });
    expect(targets.map((t) => t.id)).toEqual(["k-approach", "w-b", "w-a"]);
    expect(selectPracticeTargets({ problemWeaknesses: [] }).map((t) => t.id)).toEqual(["k-approach"]);
  });

  it("attaches the Solutions doc to the approach and the detail to a weak spot", async () => {
    const { selectPracticeTargets, withTalkReferences } = await import("./practice");
    const targets = withTalkReferences(
      selectPracticeTargets({
        problemWeaknesses: [{ id: "a", category: "init_sentinel", detail: "dp starts at 0", lastSeenAt: at(1) }],
      }),
      [{ id: "a1", name: "DP", mine: true, points: ["dp[x]: fewest coins for x"], complexity: "O(n·amount)" }],
    );
    expect(targets[0]!.reference).toEqual({
      mode: "key_points",
      approaches: [
        {
          id: "a1",
          name: "DP",
          mine: true,
          points: [
            { id: "p1", text: "dp[x]: fewest coins for x" },
            { id: "p2", text: "Complexity: O(n·amount)" },
          ],
        },
      ],
    });
    expect(targets[1]!.reference?.mode).toBe("avoid_mistake");
    expect(targets[1]!.reference?.approaches[0]!.points).toEqual([{ id: "p1", text: "dp starts at 0" }]);
    // No Solutions doc: the Coach grades the approach itself.
    expect(withTalkReferences(targets.slice(0, 1).map(({ reference: _r, ...t }) => t), [])[0]!.reference).toBeUndefined();
  });

  const g = (...grades: ("correct" | "partial" | "missed")[]) =>
    grades.map((grade, index) => ({ grade, approach: index === 0 }));

  it("scores grades, with Easy only for all correct", async () => {
    const { scoreTalk } = await import("./practice");
    expect(scoreTalk(g("correct", "correct", "correct"))).toEqual({ score: 1, rating: 4 });
    expect(scoreTalk(g("correct", "partial", "correct")).rating).toBe(3);
    expect(scoreTalk(g("correct", "missed", "partial")).rating).toBe(2);
    expect(scoreTalk(g("correct"))).toEqual({ score: 1, rating: 4 });
  });

  it("caps the suggestion by the approach", async () => {
    const { scoreTalk } = await import("./practice");
    expect(scoreTalk(g("partial", "correct", "correct")).rating).toBe(3);
    // Averaging would say Good; not recalling the approach is at most Hard.
    expect(scoreTalk(g("missed", "correct", "correct")).rating).toBe(2);
    expect(scoreTalk(g("missed", "missed", "correct")).rating).toBe(1);
    expect(scoreTalk(g("missed")).rating).toBe(1);
  });

  it("never suggests Easy for a talk-through ended early", async () => {
    const { scoreTalk } = await import("./practice");
    expect(scoreTalk(g("correct"), { endedEarly: true })).toEqual({ score: 1, rating: 3 });
    expect(scoreTalk(g("missed"), { endedEarly: true }).rating).toBe(1);
  });
});

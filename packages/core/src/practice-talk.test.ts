import { describe, expect, it } from "vitest";
import {
  EMPTY_TALK_STATE,
  advanceTalk,
  type TalkJudgement,
  type TalkMove,
  type TalkReference,
} from "./practice-talk";

const REFERENCE: TalkReference = {
  mode: "key_points",
  approaches: [
    {
      id: "a1",
      name: "lo/hi range",
      mine: true,
      points: [
        { id: "p1", text: "lo/hi track the fewest and most unmatched (" },
        { id: "p2", text: "* widens both ends by 1" },
        { id: "p3", text: "Complexity: O(n) time, O(1) space" },
      ],
    },
    {
      id: "a2",
      name: "DP",
      mine: false,
      points: [
        { id: "p1", text: "dp[i][j]: can s[i..j] be valid" },
        { id: "p2", text: "Complexity: O(n^3) time" },
      ],
    },
  ],
};

/** A Solutions doc with a signal point first (docs/product-main-line.md). */
const WITH_SIGNAL: TalkReference = {
  mode: "key_points",
  approaches: [
    {
      id: "a1",
      name: "Variable-size sliding window",
      mine: true,
      points: [
        { id: "p1", text: "Signal: contiguous subarray, all values positive, sum ≥ target" },
        { id: "p2", text: "Shrink from the left while the sum still meets the target" },
        { id: "p3", text: "Complexity: O(n) time, O(1) space" },
      ],
    },
  ],
};

const WEAK_SPOT: TalkReference = {
  mode: "avoid_mistake",
  approaches: [{ id: "w", name: "init_sentinel", mine: false, points: [{ id: "p1", text: "dp starts at 0" }] }],
};

function judged(partial: Partial<TalkJudgement>): TalkJudgement {
  return {
    reply: "answer",
    approachId: "a1",
    approachStatus: "known",
    covered: [],
    misconception: null,
    newApproachComplete: false,
    ...partial,
  };
}

/** Runs one target through replies; returns every move (the last one settles). */
function run(replies: Partial<TalkJudgement>[], reference = REFERENCE) {
  let state = EMPTY_TALK_STATE;
  const moves: TalkMove[] = [];
  for (const reply of replies) {
    const step = advanceTalk(state, judged(reply), reference);
    state = step.state;
    moves.push(step.move);
    if (step.move.kind === "settle") break;
  }
  return { moves, kinds: moves.map((move) => move.kind), last: moves.at(-1)!, state };
}

describe("advanceTalk", () => {
  it("every point on the first try is correct", () => {
    expect(run([{ covered: ["p1", "p2", "p3"] }]).last).toEqual({ kind: "settle", grade: "correct", by: "complete" });
  });

  it("a content-free 'anything else?' keeps it correct", () => {
    const result = run([{ covered: ["p1", "p2"] }, { covered: ["p1", "p2", "p3"] }]);
    expect(result.moves[0]).toEqual({ kind: "probe", reason: "more" });
    expect(result.last).toEqual({ kind: "settle", grade: "correct", by: "complete" });
  });

  it("naming the missing part caps it at partial", () => {
    const result = run([{ covered: ["p1"] }, { covered: ["p1", "p2"] }, { covered: ["p1", "p2", "p3"] }]);
    expect(result.moves[1]).toEqual({ kind: "name_gap", point: { approachId: "a1", pointId: "p3" } });
    expect(result.last).toEqual({ kind: "settle", grade: "partial", by: "complete" });
  });

  it("a named gap still missing gets a hint, which makes it missed", () => {
    const result = run([{ covered: ["p1", "p2"] }, { covered: ["p1", "p2"] }, { covered: ["p1", "p2"] }, { covered: ["p1", "p2", "p3"] }]);
    expect(result.kinds).toEqual(["probe", "name_gap", "hint", "settle"]);
    expect(result.last).toEqual({ kind: "settle", grade: "missed", by: "complete" });
  });

  it("explains after the hint doesn't help, or after three nudges", () => {
    // probe, name p3, hint p3, then still missing: out of nudges.
    expect(run([{ covered: ["p1", "p2"] }, {}, {}, {}]).last).toEqual({ kind: "settle", grade: "missed", by: "not_recalled" });
    // Progress after each nudge still stops at three.
    const progress = run([{ covered: [] }, { covered: ["p1"] }, { covered: ["p1", "p2"] }, { covered: ["p1", "p2"] }]);
    expect(progress.kinds).toEqual(["probe", "name_gap", "name_gap", "settle"]);
    expect(progress.last).toEqual({ kind: "settle", grade: "missed", by: "not_recalled" });
  });

  it("nothing recalled gets the smallest hint toward their own approach, then an explanation", () => {
    const result = run([{ reply: "blank", approachId: null, approachStatus: "unclear" }, { reply: "blank", approachId: null }]);
    expect(result.moves[0]).toEqual({ kind: "hint", point: { approachId: "a1", pointId: "p1" }, misconception: null });
    expect(result.last).toEqual({ kind: "settle", grade: "missed", by: "not_recalled" });
  });

  it("a wrong idea gets a counterexample", () => {
    const result = run([{ covered: ["p1"], misconception: "greedy on the first unmatched (" }]);
    expect(result.last).toEqual({
      kind: "hint",
      point: { approachId: "a1", pointId: "p2" },
      misconception: "greedy on the first unmatched (",
    });
    expect(result.state.help).toBe(2);
  });

  it("a wrong claim keeps it open even with every point said", () => {
    const result = run([{ covered: ["p1", "p2", "p3"], misconception: "says lo can go negative" }]);
    expect(result.last).toEqual({ kind: "hint", point: null, misconception: "says lo can go negative" });
  });

  it("asking for a hint gets one; giving up is missed", () => {
    expect(run([{ reply: "hint_request" }]).state.help).toBe(2);
    expect(run([{ reply: "give_up" }]).last).toEqual({ kind: "settle", grade: "missed", by: "gave_up" });
  });

  it("a side question or a misread changes nothing", () => {
    const result = run([{ reply: "side_question" }, { reply: "misread" }, { covered: ["p1", "p2", "p3"] }]);
    expect(result.kinds).toEqual(["reask", "reask", "settle"]);
    expect(result.last).toEqual({ kind: "settle", grade: "correct", by: "complete" });
  });

  it("a slow approach is asked to do better, for free once", () => {
    const result = run([{ approachId: null, approachStatus: "suboptimal" }, { covered: ["p1", "p2", "p3"] }]);
    expect(result.moves[0]).toEqual({ kind: "probe", reason: "faster" });
    expect(result.last).toEqual({ kind: "settle", grade: "correct", by: "complete" });
    expect(run([{ approachId: null, approachStatus: "suboptimal" }, { approachId: null, approachStatus: "suboptimal" }]).last.kind).toBe("hint");
  });

  it("a valid approach the doc doesn't have", () => {
    expect(run([{ approachId: null, approachStatus: "new_valid", newApproachComplete: true }]).last).toEqual({
      kind: "settle",
      grade: "correct",
      by: "new_approach",
    });
    const vague = run([{ approachId: null, approachStatus: "new_valid" }, { approachId: null, approachStatus: "new_valid" }]);
    expect(vague.kinds).toEqual(["probe", "settle"]);
    expect(vague.last).toEqual({ kind: "settle", grade: "partial", by: "new_approach" });
  });

  it("switching approach starts its points over", () => {
    const result = run([{ covered: ["p1", "p2"] }, { approachId: "a2", covered: ["p1"] }]);
    expect(result.state.approachId).toBe("a2");
    expect(result.state.covered).toEqual(["p1"]);
    expect(result.last).toEqual({ kind: "name_gap", point: { approachId: "a2", pointId: "p2" } });
  });

  it("ignores point ids the approach doesn't have", () => {
    expect(run([{ covered: ["p1", "p2", "p9"] }]).state.covered).toEqual(["p1", "p2"]);
  });

  it("the signal is an ordinary point: all said at once is correct", () => {
    expect(run([{ covered: ["p1", "p2", "p3"] }], WITH_SIGNAL).last).toEqual({ kind: "settle", grade: "correct", by: "complete" });
  });

  it("an approach explained without its signal names the signal gap first; saying it then is partial", () => {
    const result = run([{ covered: ["p2", "p3"] }, { covered: ["p2", "p3"] }, { covered: ["p1", "p2", "p3"] }], WITH_SIGNAL);
    expect(result.moves.slice(0, 2)).toEqual([
      { kind: "probe", reason: "more" },
      { kind: "name_gap", point: { approachId: "a1", pointId: "p1" } },
    ]);
    expect(result.last).toEqual({ kind: "settle", grade: "partial", by: "complete" });
  });

  it("a signal said only after a hint is missed, whether or not the judge credits it", () => {
    const toHint = [{ covered: ["p2", "p3"] }, { covered: ["p2", "p3"] }, { covered: ["p2", "p3"] }];
    const credited = run([...toHint, { covered: ["p1", "p2", "p3"] }], WITH_SIGNAL);
    expect(credited.kinds).toEqual(["probe", "name_gap", "hint", "settle"]);
    expect(credited.last).toEqual({ kind: "settle", grade: "missed", by: "complete" });
    const notCredited = run([...toHint, { covered: ["p2", "p3"] }], WITH_SIGNAL);
    expect(notCredited.last).toEqual({ kind: "settle", grade: "missed", by: "not_recalled" });
  });

  it("nothing recalled gets a hint toward the signal first", () => {
    expect(run([{ reply: "blank", approachId: null, approachStatus: "unclear" }], WITH_SIGNAL).last).toEqual({
      kind: "hint",
      point: { approachId: "a1", pointId: "p1" },
      misconception: null,
    });
  });

  it("a weak spot is settled by its one point", () => {
    expect(run([{ approachId: null, covered: ["p1"] }], WEAK_SPOT).last).toEqual({
      kind: "settle",
      grade: "correct",
      by: "complete",
    });
    // The judge ticking the mistake itself doesn't count when it's repeated.
    expect(run([{ approachId: "w", covered: ["p1"], misconception: "starts dp at 0 again" }], WEAK_SPOT).last.kind).toBe("hint");
    const repeated = run([{ approachId: null, misconception: "starts dp at 0 again" }], WEAK_SPOT);
    expect(repeated.last).toEqual({
      kind: "hint",
      point: { approachId: "w", pointId: "p1" },
      misconception: "starts dp at 0 again",
    });
  });
});

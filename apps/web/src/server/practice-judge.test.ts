import { describe, expect, it } from "vitest";
import { EMPTY_TALK_STATE, type TalkReference } from "@ankify/core";
import { JUDGE_CASES } from "./practice-judge.cases";
import { shortcutJudgement } from "./practice-judge";
import { askInstruction, moveInstruction } from "./practice-instructions";

describe("judge eval cases", () => {
  it("only name approaches and points their reference has", () => {
    for (const { id, input, expected } of JUDGE_CASES) {
      const approach =
        input.reference.approaches.find((candidate) => candidate.id === expected.approachId) ??
        (input.reference.approaches.length === 1 ? input.reference.approaches[0] : undefined);
      if (expected.approachId) expect(approach, id).toBeDefined();
      const named = [...(expected.covered ?? []), ...(expected.maybe ?? [])];
      if (named.length && approach) {
        const ids = approach.points.map((point) => point.id);
        expect(named.filter((point) => !ids.includes(point)), id).toEqual([]);
      }
      expect(input.log.at(-1)?.role, id).toBe("learner");
    }
  });
});

describe("shortcutJudgement", () => {
  it("reads obvious skips and blanks without a model call", () => {
    expect(shortcutJudgement("skip")?.reply).toBe("give_up");
    expect(shortcutJudgement("跳过。")?.reply).toBe("give_up");
    expect(shortcutJudgement("I don't know")?.reply).toBe("blank");
    expect(shortcutJudgement("不知道")?.reply).toBe("blank");
    expect(shortcutJudgement("I don't know why lo can't go negative")).toBeNull();
  });
});

const REFERENCE: TalkReference = {
  mode: "key_points",
  approaches: [
    {
      id: "a1",
      name: "lo/hi range",
      mine: true,
      points: [
        { id: "p1", text: "lo and hi track the fewest and most unmatched (" },
        { id: "p2", text: "* lowers lo and raises hi" },
      ],
    },
  ],
};

describe("moveInstruction", () => {
  const state = { ...EMPTY_TALK_STATE, approachId: "a1", covered: ["p1"] };
  const none = { kind: "none" } as const;

  it("never puts a point's content in a content-free move", () => {
    for (const reason of ["more", "faster"] as const) {
      const text = moveInstruction({ move: { kind: "probe", reason }, reference: REFERENCE, state, next: none });
      for (const point of REFERENCE.approaches[0]!.points) expect(text).not.toContain(point.text);
    }
  });

  it("names the gap for the Coach, and explains everything on a miss", () => {
    const gap = moveInstruction({
      move: { kind: "name_gap", point: { approachId: "a1", pointId: "p2" } },
      reference: REFERENCE,
      state,
      next: none,
    });
    expect(gap).toContain("* lowers lo and raises hi");
    expect(gap).toContain("never its content");
    const missed = moveInstruction({
      move: { kind: "settle", grade: "missed", by: "not_recalled" },
      reference: REFERENCE,
      state,
      next: { kind: "completed", correct: 0, total: 1, suggestedRating: 1 },
    });
    expect(missed).toContain("- lo and hi track the fewest and most unmatched (");
    expect(missed).toContain("- * lowers lo and raises hi");
    expect(missed).toContain("suggested rating Again");
  });

  it("asks for the signal without giving the pattern away", () => {
    const signal = "Signal: contiguous subarray, all values positive";
    const reference: TalkReference = {
      mode: "key_points",
      approaches: [{ id: "a1", name: "Variable-size sliding window", mine: true, points: [{ id: "p1", text: signal }] }],
    };
    const point = { approachId: "a1", pointId: "p1" };
    const gap = moveInstruction({ move: { kind: "name_gap", point }, reference, state: EMPTY_TALK_STATE, next: none });
    expect(gap).toContain("what in the problem made them think of that approach");
    expect(gap).not.toContain("contiguous");
    expect(gap).not.toContain("sliding window");
    const hint = moveInstruction({ move: { kind: "hint", point, misconception: null }, reference, state: EMPTY_TALK_STATE, next: none });
    expect(hint).toContain("one clue");
    expect(hint).toContain(signal);
  });

  it("opens the approach question with the technique and what points to it", () => {
    const ask = askInstruction({ id: "k-approach", kind: "core", label: "approach" });
    expect(ask).toContain("which technique");
    expect(ask).toContain("what in the problem statement points to it");
    expect(ask).toContain("what it costs");
  });

  it("moves on to the next question after settling", () => {
    const next = { kind: "target", target: { id: "w-1", kind: "weakness", label: "dp starts at 0" } } as const;
    const text = moveInstruction({ move: { kind: "settle", grade: "correct", by: "complete" }, reference: REFERENCE, state, next });
    expect(text).toContain(askInstruction(next.target));
  });
});

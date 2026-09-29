import { describe, expect, it } from "vitest";
import type { SkillDimension } from "../skills";
import { clampShares, deficits, nextType, typeShares, type FeedTypeKey } from "./allocate";
import { FEED_PARAMS } from "./params";

function sum(values: Iterable<number>) {
  return [...values].reduce((total, value) => total + value, 0);
}

describe("clampShares", () => {
  it("keeps proportional shares that are already inside the bounds", () => {
    const shares = clampShares(new Map([["a", 0.48], ["b", 0.33]]), 0.15, 0.6);
    expect(shares.get("a")).toBeCloseTo(0.5926, 4);
    expect(shares.get("b")).toBeCloseTo(0.4074, 4);
  });

  it("caps a dominant type and gives its excess to the others", () => {
    const shares = clampShares(new Map([["a", 0.9], ["b", 0.1]]), 0.15, 0.6);
    expect(shares.get("a")).toBeCloseTo(0.6, 6);
    expect(shares.get("b")).toBeCloseTo(0.4, 6);
  });

  it("raises a starved type to the floor", () => {
    const shares = clampShares(new Map([["a", 0.7], ["b", 0.25], ["c", 0.05]]), 0.15, 0.6);
    expect(shares.get("a")).toBeCloseTo(0.6, 6);
    expect(shares.get("b")).toBeCloseTo(0.25, 6);
    expect(shares.get("c")).toBeCloseTo(0.15, 6);
    expect(sum(shares.values())).toBeCloseTo(1, 9);
  });

  it("always sums to one, even when the bounds cannot all hold", () => {
    const many = new Map(["a", "b", "c", "d", "e", "f", "g"].map((key, i) => [key, i === 0 ? 10 : 0.01]));
    expect(sum(clampShares(many, 0.15, 0.6).values())).toBeCloseTo(1, 9);
    expect(clampShares(new Map([["only", 5]]), 0.15, 0.6).get("only")).toBe(1);
  });
});

describe("typeShares", () => {
  it("splits 0.85 between weak dimensions and keeps 0.15 for check-ups", () => {
    const shares = typeShares(new Map<SkillDimension, number>([["invariant", 0.48], ["edge_case", 0.33]]), FEED_PARAMS);
    expect(shares.get("invariant")).toBeCloseTo(0.5037, 4);
    expect(shares.get("edge_case")).toBeCloseTo(0.3463, 4);
    expect(shares.get("checkup")).toBeCloseTo(0.15, 6);
  });

  it("gives everything to check-ups when nothing is weak", () => {
    expect([...typeShares(new Map(), FEED_PARAMS)]).toEqual([["checkup", 1]]);
  });
});

describe("deficit round-robin", () => {
  function allocateDay(shares: Map<FeedTypeKey, number>, served: Map<FeedTypeKey, number>, slots: number) {
    const deficit = deficits(shares, served, slots);
    const servedToday = new Map<FeedTypeKey, number>();
    const picks: FeedTypeKey[] = [];
    for (let slot = 0; slot < slots; slot += 1) {
      const type = nextType({
        deficit,
        servedToday,
        exhausted: new Set<FeedTypeKey>(),
        perDayCap: Math.max(1, slots - 1),
        tieBreak: () => 0,
      })!;
      deficit.set(type, deficit.get(type)! - 1);
      servedToday.set(type, (servedToday.get(type) ?? 0) + 1);
      served.set(type, (served.get(type) ?? 0) + 1);
      picks.push(type);
    }
    return picks;
  }

  it("reproduces the documented two-day example", () => {
    const shares = typeShares(new Map<SkillDimension, number>([["invariant", 0.48], ["edge_case", 0.33]]), FEED_PARAMS);
    const served = new Map<FeedTypeKey, number>();
    expect(allocateDay(shares, served, 3)).toEqual(["invariant", "edge_case", "invariant"]);
    expect(allocateDay(shares, served, 3)).toEqual(["edge_case", "invariant", "checkup"]);
  });

  it("converges to the shares over four weeks", () => {
    const shares = typeShares(new Map<SkillDimension, number>([["invariant", 0.48], ["edge_case", 0.33]]), FEED_PARAMS);
    const served = new Map<FeedTypeKey, number>();
    for (let day = 0; day < 28; day += 1) allocateDay(shares, served, 3);
    for (const [type, share] of shares) {
      expect(Math.abs((served.get(type) ?? 0) / 84 - share)).toBeLessThan(0.02);
    }
  });

  it("respects the per-day cap while another type has room, and ignores it otherwise", () => {
    const deficit = new Map<string, number>([["a", 5], ["b", 0]]);
    const common = { deficit, exhausted: new Set<string>(), perDayCap: 2, tieBreak: () => 0 };
    expect(nextType({ ...common, servedToday: new Map([["a", 2]]) })).toBe("b");
    expect(nextType({ ...common, servedToday: new Map([["a", 2]]), exhausted: new Set(["b"]) })).toBe("a");
    expect(nextType({ ...common, servedToday: new Map(), exhausted: new Set(["a", "b"]) })).toBeNull();
  });

  it("breaks exact ties with the seeded hash", () => {
    const deficit = new Map<string, number>([["a", 1], ["b", 1]]);
    const pick = (favorite: string) =>
      nextType({ deficit, servedToday: new Map(), exhausted: new Set(), perDayCap: 2, tieBreak: (k) => (k === favorite ? 1 : 0) });
    expect(pick("a")).toBe("a");
    expect(pick("b")).toBe("b");
  });
});

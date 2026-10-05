import { describe, expect, it } from "vitest";
import {
  WEAKNESS_CATEGORIES,
  builtinWeaknessCategoryName,
  computeWeaknessProfile,
  findDuplicateWeakness,
  isBuiltinWeaknessCategory,
  type WeaknessLike,
} from "./weaknesses";

describe("weakness categories", () => {
  it("has unique keys and both languages", () => {
    const keys = WEAKNESS_CATEGORIES.map((category) => category.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(isBuiltinWeaknessCategory("init_sentinel")).toBe(true);
    expect(isBuiltinWeaknessCategory("made_up")).toBe(false);
    expect(builtinWeaknessCategoryName("complexity", "zh")).toBe("复杂度判断");
  });
});

describe("findDuplicateWeakness", () => {
  const active = [
    { id: "w1", category: "init_sentinel", detail: "dp initialized to 0 so amount 0 returned the wrong count" },
    { id: "w2", category: "complexity", detail: "called it O(n log n) though nothing sorts" },
  ];

  it("matches the same category with a similar detail", () => {
    expect(findDuplicateWeakness(active, "init_sentinel", "dp initialized to 0, amount 0 returned a wrong count")?.id).toBe("w1");
  });

  it("keeps different mistakes apart", () => {
    expect(findDuplicateWeakness(active, "init_sentinel", "used Infinity as the sentinel and returned a float")).toBeNull();
    expect(findDuplicateWeakness(active, "boundary_index", "dp initialized to 0 so amount 0 returned the wrong count")).toBeNull();
  });
});

describe("computeWeaknessProfile", () => {
  const now = new Date("2026-10-05T00:00:00Z");
  const day = (n: number) => new Date(now.getTime() - n * 86_400_000);
  const w = (overrides: Partial<WeaknessLike>): WeaknessLike => ({
    problemId: "p1",
    category: "init_sentinel",
    status: "active",
    hitCount: 1,
    lastSeenAt: day(1),
    resolvedAt: null,
    ...overrides,
  });

  it("ranks categories by active weaknesses, ignoring dismissed ones", () => {
    const profile = computeWeaknessProfile(
      [
        w({}),
        w({ problemId: "p2", hitCount: 3 }),
        w({ category: "complexity", status: "resolved", resolvedAt: day(2), hitCount: 2 }),
        w({ category: "edge_cases", status: "dismissed", hitCount: 9 }),
        w({ category: "complexity", lastSeenAt: day(60) }),
      ],
      now,
    );
    expect(profile.map((entry) => entry.category)).toEqual(["init_sentinel", "complexity"]);
    expect(profile[0]).toMatchObject({ active: 2, hits: 4, problemIds: ["p1", "p2"], recent: 2 });
    expect(profile[1]).toMatchObject({ active: 1, resolved: 1, recent: 0, recentlyResolved: 1 });
  });
});

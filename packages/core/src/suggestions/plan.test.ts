import { describe, expect, it } from "vitest";
import type { SkillDimension } from "../skills";
import type { LeetCodeDifficulty } from "../types";
import { planSuggestion, SUGGESTION_PLANNER_VERSION } from "./plan";
import type { SuggestionCandidate, SuggestionPlanInput, SuggestionProblem } from "./types";

const VERIFIED = new Date("2026-09-01T00:00:00.000Z");
const candidate = (slug: string, difficulty: LeetCodeDifficulty = "Medium", overrides: Partial<SuggestionCandidate> = {}): SuggestionCandidate => ({
  slug, title: slug, difficulty, paidOnly: false, topicTags: [], verifiedAt: VERIFIED, ...overrides,
});
const problem = (id: string, similarSlugs: string[], overrides: Partial<SuggestionProblem> = {}): SuggestionProblem => ({
  id, title: `Title ${id}`, difficulty: "Medium", topics: ["Array"], similarSlugs, confirmedContexts: {}, ...overrides,
});
const weak = (category: SkillDimension, weakness: number, contexts = 2) => ({ category, weakness, weak: true, ready: true, contexts });

function input(overrides: Partial<SuggestionPlanInput> = {}): SuggestionPlanInput {
  return {
    seed: "user-1",
    dateKey: "2026-09-30",
    ordinal: 0,
    profile: { personalized: true, categories: [], topics: [] },
    problems: [],
    candidates: [],
    attempted: new Set(),
    history: [],
    recentDifficulties: [],
    ...overrides,
  };
}

const targetOf = (plan: ReturnType<typeof planSuggestion>) => (plan.kind === "suggestion" ? plan.target.slug : null);

describe("new-problem suggestions", () => {
  it("targets a weak, confirmed dimension with a similar question of the problem where it failed", () => {
    const plan = planSuggestion(input({
      profile: { personalized: true, categories: [weak("edge_case", 0.48, 3)], topics: [] },
      problems: [problem("p1", ["same-level", "harder"], { confirmedContexts: { edge_case: 2 } }), problem("p2", ["unrelated"], { topics: ["Graph"] })],
      candidates: [candidate("same-level", "Medium"), candidate("harder", "Hard"), candidate("unrelated", "Easy")],
    }));
    expect(plan).toEqual({
      kind: "suggestion",
      target: { slug: "same-level", title: "same-level", difficulty: "Medium", topicTags: [] },
      category: "edge_case",
      lane: "personalized",
      reasons: [
        { code: "category_focus", category: "edge_case", contexts: 3 },
        { code: "similar_to", problemId: "p1", title: "Title p1", category: "edge_case" },
      ],
      plannerVersion: SUGGESTION_PLANNER_VERSION,
    });
  });

  it("suggests only verified, free problems that were never attempted, not pending, and not shown in 30 days", () => {
    const blocked = [
      candidate("paid", "Easy", { paidOnly: true }),
      candidate("unverified", "Easy", { verifiedAt: null }),
      candidate("attempted", "Easy"),
      candidate("pending-old", "Easy"),
      candidate("shown-30-days-ago", "Easy"),
    ];
    const base = input({
      profile: { personalized: false, categories: [], topics: [] },
      candidates: blocked,
      attempted: new Set(["attempted"]),
      history: [
        { dateKey: "2026-07-01", slug: "pending-old", category: null, pending: true },
        { dateKey: "2026-08-31", slug: "shown-30-days-ago", category: null, pending: false },
        { dateKey: "2026-08-30", slug: "shown-31-days-ago", category: null, pending: false },
      ],
    });
    expect(planSuggestion(base)).toEqual({ kind: "none", reason: "no_candidates" });
    expect(targetOf(planSuggestion({ ...base, candidates: [...blocked, candidate("shown-31-days-ago", "Hard")] }))).toBe("shown-31-days-ago");
  });

  it("labels general practice truthfully", () => {
    const candidates = [candidate("a", "Easy", { topicTags: ["Graph"] })];
    const whyOf = (overrides: Partial<SuggestionPlanInput>) => {
      const plan = planSuggestion(input({ candidates, ...overrides }));
      return plan.kind === "suggestion" ? { lane: plan.lane, category: plan.category, reason: plan.reasons[0] } : null;
    };
    // Weak dimensions are ignored until the profile is personalized.
    expect(whyOf({ profile: { personalized: false, categories: [weak("approach", 0.5)], topics: [] } }))
      .toEqual({ lane: "general", category: null, reason: { code: "general_practice", why: "not_personalized" } });
    expect(whyOf({ profile: { personalized: true, categories: [{ ...weak("approach", 0.5), ready: false }], topics: [] } }))
      .toEqual({ lane: "general", category: null, reason: { code: "general_practice", why: "no_focus" } });
    // Weak and confirmed, but nothing eligible relates to it.
    expect(whyOf({ profile: { personalized: true, categories: [weak("approach", 0.5)], topics: [] }, problems: [problem("p1", [], { confirmedContexts: { approach: 2 } })] }))
      .toEqual({ lane: "general", category: null, reason: { code: "general_practice", why: "no_targeted_candidate" } });
    // The rotation's general share, after the weak dimension was served.
    const served = Array.from({ length: 6 }, (_, index) => ({ dateKey: `2026-09-2${index}`, slug: `old-${index}`, category: "approach" as const, pending: false }));
    expect(whyOf({
      profile: { personalized: true, categories: [weak("approach", 0.5)], topics: [] },
      problems: [problem("p1", ["a"], { confirmedContexts: { approach: 2 } })],
      history: served,
    })).toEqual({ lane: "general", category: null, reason: { code: "general_practice", why: "rotation" } });
  });

  it("starts from the user's practiced topics and recent difficulty, and from Easy with no history", () => {
    const candidates = [
      candidate("graph-medium", "Medium", { topicTags: ["Graph"] }),
      candidate("graph-hard", "Hard", { topicTags: ["Graph"] }),
      candidate("array-medium", "Medium", { topicTags: ["Array"] }),
      candidate("string-easy", "Easy", { topicTags: ["String"] }),
    ];
    const plan = planSuggestion(input({
      profile: { personalized: false, categories: [], topics: [{ topic: "Graph", sessions: 5 }, { topic: "Array", sessions: 1 }] },
      candidates,
      recentDifficulties: ["Medium", "Medium", "Easy"],
    }));
    expect(plan).toMatchObject({ target: { slug: "graph-medium" }, reasons: [{ code: "general_practice", why: "not_personalized" }, { code: "topic_match", topic: "Graph" }] });
    expect(targetOf(planSuggestion(input({ profile: { personalized: false, categories: [], topics: [] }, candidates })))).toBe("string-easy");
  });

  it("is the same for the same user, day, and ordinal, and varies across a day's extra suggestions", () => {
    const candidates = Array.from({ length: 12 }, (_, index) => candidate(`even-${index}`, "Easy"));
    const at = (ordinal: number, seed = "user-1") => planSuggestion(input({ seed, ordinal, profile: { personalized: false, categories: [], topics: [] }, candidates }));
    expect(at(0)).toEqual(at(0));
    expect(new Set([0, 1, 2, 3, 4, 5].map((ordinal) => targetOf(at(ordinal)))).size).toBeGreaterThan(1);
    expect(new Set(["a", "b", "c", "d", "e"].map((seed) => targetOf(at(0, seed)))).size).toBeGreaterThan(1);
  });

  it("explains a topic-only match as a topic, never as similarity to a failed problem", () => {
    const plan = planSuggestion(input({
      profile: { personalized: true, categories: [weak("invariant", 0.5)], topics: [] },
      problems: [
        problem("failed-dp", [], { topics: ["Dynamic Programming"], confirmedContexts: { invariant: 2 } }),
        problem("clean-array", ["dp-like"], { topics: ["Array"] }),
      ],
      candidates: [candidate("dp-like", "Medium", { topicTags: ["Dynamic Programming"] })],
    }));
    expect(plan).toMatchObject({
      category: "invariant",
      reasons: [{ code: "category_focus", category: "invariant" }, { code: "topic_match", topic: "Dynamic Programming" }],
    });
  });

  it("rotates weak dimensions by weight over four weeks without starving either", () => {
    const pool = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
    const invariantSlugs = pool("inv", 30);
    const edgeSlugs = pool("edge", 30);
    const generalSlugs = pool("gen", 30);
    const base = input({
      profile: { personalized: true, categories: [weak("invariant", 0.48), weak("edge_case", 0.33)], topics: [] },
      problems: [
        problem("p-inv", invariantSlugs, { topics: ["Dynamic Programming"], confirmedContexts: { invariant: 2 } }),
        problem("p-edge", edgeSlugs, { topics: ["Two Pointers"], confirmedContexts: { edge_case: 2 } }),
      ],
      candidates: [...invariantSlugs, ...edgeSlugs, ...generalSlugs].map((slug) => candidate(slug, "Medium")),
    });
    const history: SuggestionPlanInput["history"][number][] = [];
    const lastServed = new Map<string, number>();
    let longestGap = 0;
    for (let day = 0; day < 28; day += 1) {
      const dateKey = new Date(Date.UTC(2026, 8, 1 + day)).toISOString().slice(0, 10);
      const plan = planSuggestion({ ...base, dateKey, history });
      if (plan.kind !== "suggestion") throw new Error("no suggestion");
      history.push({ dateKey, slug: plan.target.slug, category: plan.category, pending: false });
      const key = plan.category ?? "general";
      lastServed.set(key, day);
      for (const category of ["invariant", "edge_case"]) longestGap = Math.max(longestGap, day - (lastServed.get(category) ?? -1));
    }
    const share = (category: SkillDimension | null) => history.filter((item) => item.category === category).length / history.length;
    // Targets: 0.85 split 0.59/0.41 by weakness, and 0.15 general.
    expect(Math.abs(share("invariant") - 0.504)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(share("edge_case") - 0.346)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(share(null) - 0.15)).toBeLessThanOrEqual(0.1);
    expect(longestGap).toBeLessThanOrEqual(7);
    expect(new Set(history.map((item) => item.slug)).size).toBe(28);
  });
});

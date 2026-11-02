import { describe, expect, it } from "vitest";
import type { PlanCatalog, PlanCatalogNode, PlanCatalogProblem } from "@ankify/core/plan-catalog";
import {
  NO_FILTERS,
  applyTick,
  autoOpenMatches,
  buildPlanIndex,
  computePlanList,
  filtersActive,
  isInScope,
  parsePlanView,
  planListGroups,
  planProblemUrl,
  ratingTone,
  sanitizeFilters,
  type PlanStatuses,
} from "./plan-map-model";

function problem(slug: string, id: number, extra: Partial<PlanCatalogProblem> = {}): PlanCatalogProblem {
  return {
    slug,
    id,
    label: String(id),
    zh: `题${slug}`,
    en: `Problem ${slug}`,
    rating: 1500,
    difficulty: "Medium",
    premium: false,
    cnOnly: false,
    tags: [],
    ...extra,
  };
}

function node(id: string, kind: PlanCatalogNode["kind"], extra: Partial<PlanCatalogNode> = {}): PlanCatalogNode {
  return { id, kind, title: { en: `Node ${id}`, zh: `节点${id}` }, problems: [], children: [], ...extra };
}

const problems = Object.fromEntries(
  [
    problem("a", 1),
    problem("b", 2, { rating: 2100, tags: ["nc150"] }),
    problem("c", 3, { premium: true, rating: null, difficulty: "Hard" }),
    problem("d", 0, { en: "", label: "LCP 1", cnOnly: true, rating: null, difficulty: null }),
    problem("e", 5),
  ].map((entry) => [entry.slug, entry]),
);

const catalog: PlanCatalog = {
  problems,
  tree: node("root", "root", {
    children: [
      node("gL", "group", {
        children: [
          node("C", "block", {
            children: [node("V0", "video", { problems: ["a"], homework: ["b"], videoUrl: "https://b/1" })],
          }),
          node("X", "block", { children: [node("X1", "step", { problems: ["a", "d"] })] }),
          node("G", "dictionary", {
            children: [
              node("L0", "list", {
                children: [
                  node("L0.0", "section", {
                    title: { en: "Sliding window", zh: "滑动窗口" },
                    problems: ["a", "c"],
                    children: [node("L0.0.0", "section", { problems: ["e"] })],
                  }),
                  node("L0.1", "section", { problems: ["b", "d"] }),
                ],
              }),
            ],
          }),
        ],
      }),
      node("gH", "group", {
        children: [
          node("N", "block", { children: [node("N0", "section", { problems: ["a", "b"] })] }),
          node("H", "block"),
          node("T", "block"),
          node("O:leetcode-75", "block"),
        ],
      }),
    ],
  }),
};

const index = buildPlanIndex(catalog);
const base = { index, filters: NO_FILTERS, statuses: {} as PlanStatuses, language: "zh" as const, site: "com" as const };

describe("computePlanList", () => {
  it("counts each problem once and solved from statuses", () => {
    const states = computePlanList({ ...base, statuses: { a: { status: "solved" } } });
    expect(states.get("L0")!.all.size).toBe(5);
    expect(states.get("L0")!.solved).toBe(1);
    expect(states.get("V0")!.rows).toEqual(["a"]);
    expect(states.get("V0")!.homework).toEqual(["b"]);
  });

  it("leaves leetcode.cn-only problems out in English unless the site is leetcode.cn", () => {
    expect(computePlanList({ ...base, language: "en" }).get("X1")!.all.size).toBe(1);
    expect(computePlanList({ ...base, language: "en", site: "cn" }).get("X1")!.all.size).toBe(2);
    expect(computePlanList(base).get("X1")!.all.size).toBe(2);
  });

  it("searches by exact number, by title in either language, and by label", () => {
    const search = (q: string) => [...computePlanList({ ...base, filters: { ...NO_FILTERS, q } }).get("root")!.matched];
    expect(search("1")).toEqual(["a"]);
    expect(search("Problem b")).toEqual(["b"]);
    expect(search("题e")).toEqual(["e"]);
    expect(search("lcp 1")).toEqual(["d"]);
  });

  it("a search naming a section keeps its problems, and other filters still apply", () => {
    const named = computePlanList({ ...base, filters: { ...NO_FILTERS, q: "滑动窗口" } });
    expect(named.get("L0.0")!.rows).toEqual(["a", "c"]);
    expect([...named.get("L0.0")!.matched].sort()).toEqual(["a", "c", "e"]);
    expect(named.get("L0.1")!.matched.size).toBe(0);
    const noPremium = computePlanList({ ...base, filters: { ...NO_FILTERS, q: "sliding window", hidePremium: true } });
    expect(noPremium.get("L0.0")!.rows).toEqual(["a"]);
  });

  it("applies tag, rating cap, solved, and due filters but keeps unfiltered totals", () => {
    const statuses: PlanStatuses = { a: { status: "due", problemId: "p" }, e: { status: "solved", ticked: true } };
    const filter = (filters: Partial<typeof NO_FILTERS>) =>
      computePlanList({ ...base, statuses, filters: { ...NO_FILTERS, ...filters } }).get("root")!;
    expect([...filter({ tag: "nc150" }).matched]).toEqual(["b"]);
    expect(filter({ cap: 1700 }).matched.has("b")).toBe(false);
    expect(filter({ cap: 1700 }).matched.has("c")).toBe(false); // no rating and Hard
    expect(filter({ cap: 1700 }).matched.has("d")).toBe(true); // no rating, no difficulty
    expect([...filter({ onlyDue: true }).matched]).toEqual(["a"]);
    expect(filter({ hideDone: true }).matched.has("a")).toBe(false);
    expect(filter({ hideDone: true }).all.size).toBe(5);
  });

  it("narrows only the NeetCode block with its toggle", () => {
    const states = computePlanList({ ...base, nc150Block: true });
    expect([...states.get("N")!.all]).toEqual(["b"]);
    expect(states.get("N0")!.rows).toEqual(["b"]);
    expect(states.get("L0")!.all.size).toBe(5);
  });
});

describe("autoOpenMatches", () => {
  const roots = [index.nodes.get("L0")!, index.nodes.get("N")!];

  it("opens matches, stopping after the row cap", () => {
    const states = computePlanList(base);
    const all = autoOpenMatches(roots, states, 100);
    expect(all.open.has("L0.1")).toBe(true);
    expect(all.rendered).toBe(all.rows);

    const cut = autoOpenMatches(roots, states, 2);
    expect(cut.open.has("L0.0")).toBe(true);
    expect(cut.open.has("N0")).toBe(false);
    expect(cut.rows).toBeGreaterThan(cut.rendered);
  });

  it("never opens a section with no matches", () => {
    const states = computePlanList({ ...base, filters: { ...NO_FILTERS, q: "题e" } });
    const { open, unique } = autoOpenMatches(roots, states, 100);
    expect(open.has("L0.0.0")).toBe(true);
    expect(open.has("L0.1")).toBe(false);
    expect(unique).toBe(1);
  });
});

describe("applyTick", () => {
  it("adds and removes a plain tick", () => {
    const ticked = applyTick({}, "a", true);
    expect(ticked.a).toEqual({ status: "solved", ticked: true });
    expect(applyTick(ticked, "a", false).a).toBeUndefined();
  });

  it("keeps a problem with evidence when unticked", () => {
    const entry = { status: "remembered" as const, problemId: "p", auto: true, ticked: true };
    expect(applyTick({ a: entry }, "a", false).a).toEqual({ status: "remembered", problemId: "p", auto: true });
  });
});

describe("scopes and small helpers", () => {
  it("shows one list on its own, opening it", () => {
    expect(planListGroups(index, "all").map((group) => group.key)).toEqual(["ling", "frequent", "dictionary"]);
    const [course] = planListGroups(index, "course");
    expect(course).toMatchObject({ key: "ling", single: true });
    expect(course!.blocks[0]!.id).toBe("C");
    expect(planListGroups(index, "dictionary")[0]!.blocks.map((block) => block.id)).toEqual(["L0"]);
  });

  it("knows which sections a scope shows", () => {
    expect(isInScope(index, "L0.0", "dictionary")).toBe(true);
    expect(isInScope(index, "L0.0", "core")).toBe(false);
    expect(isInScope(index, "N0", "nc150")).toBe(true);
    expect(isInScope(index, "L0.0", "all")).toBe(true);
  });

  it("links leetcode.cn-only problems to leetcode.cn on either site", () => {
    expect(planProblemUrl(problems.a!, "com")).toBe("https://leetcode.com/problems/a/");
    expect(planProblemUrl(problems.a!, "cn")).toBe("https://leetcode.cn/problems/a/");
    expect(planProblemUrl(problems.d!, "com")).toBe("https://leetcode.cn/problems/d/");
  });

  it("tones ratings by band", () => {
    expect([1399, 1400, 1899, 1900].map(ratingTone)).toEqual(["text-easy", "text-medium", "text-medium", "text-hard"]);
  });

  it("restores saved filters, dropping anything else", () => {
    expect(sanitizeFilters({ q: "x", tag: "nope", cap: 1234, hideDone: true, extra: 1 })).toEqual({
      ...NO_FILTERS,
      q: "x",
      hideDone: true,
    });
    expect(sanitizeFilters("garbage")).toEqual(NO_FILTERS);
    expect(filtersActive(NO_FILTERS)).toBe(false);
    expect(filtersActive({ ...NO_FILTERS, q: "  " })).toBe(false);
    expect(filtersActive({ ...NO_FILTERS, onlyDue: true })).toBe(true);
  });

  it("defaults to the plan view", () => {
    expect(parsePlanView("list")).toBe("list");
    expect(parsePlanView("map")).toBe("map");
    expect(parsePlanView("nonsense")).toBe("plan");
    expect(parsePlanView(undefined)).toBe("plan");
  });
});

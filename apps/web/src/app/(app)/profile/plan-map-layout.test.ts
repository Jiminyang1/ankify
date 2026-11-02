import type { PlanStatusEntryDto } from "@ankify/contracts";
import { planCatalog, planListSets } from "@ankify/core/plan-catalog";
import { describe, expect, it } from "vitest";
import {
  clampPlanMapView,
  fitPlanMapView,
  layoutPlanMap,
  levelExpansion,
  planMapCounts,
  planMapInWindow,
  searchPlanMap,
  zoomPlanMapAt,
  PLAN_MAP_ZOOM_MIN,
  type PlanMapLayout,
} from "./plan-map-layout";
import {
  NO_FILTERS,
  PLAN_ONLY,
  buildPlanIndex,
  computePlanList,
  isInScope,
  pathToRoot,
  planOnlyNode,
  type PlanLanguage,
  type PlanOnly,
} from "./plan-map-model";

const index = buildPlanIndex(planCatalog());

function statesFor(language: PlanLanguage = "zh", only: PlanOnly = "all", statuses: Record<string, PlanStatusEntryDto> = {}) {
  return computePlanList({ index, filters: NO_FILTERS, statuses, language, site: "com", nc150Block: only === "nc150" });
}

function everything(): Set<string> {
  return new Set(index.nodes.keys());
}

function layoutOf(expanded: ReadonlySet<string>, only: PlanOnly = "all", language: PlanLanguage = "zh") {
  return layoutPlanMap({ index, states: statesFor(language, only), expanded, only });
}

function overlaps(layout: PlanMapLayout): string[] {
  const sorted = [...layout.nodes].sort((a, b) => a.y - b.y);
  const clashes: string[] = [];
  // Nodes overlap only if they're close vertically, so look back a short way.
  const active: typeof sorted = [];
  for (const node of sorted) {
    for (let i = active.length - 1; i >= 0; i -= 1) {
      const other = active[i]!;
      if (other.y + other.h <= node.y) {
        active.splice(i, 1);
      } else if (node.x < other.x + other.w && other.x < node.x + node.w) {
        clashes.push(`${other.id} / ${node.id}`);
      }
    }
    active.push(node);
  }
  return clashes;
}

describe("layoutPlanMap", () => {
  const full = layoutOf(everything());

  it("draws the whole tree, thousands of nodes, without overlaps", () => {
    expect(full.nodes.length).toBeGreaterThan(5000);
    expect(overlaps(full)).toEqual([]);
    for (const level of ["lists", "steps", "all"] as const) {
      expect(overlaps(layoutOf(levelExpansion(index, level, "all")))).toEqual([]);
    }
  });

  it("puts children right of their parents and keeps them in the map's bounds", () => {
    for (const node of full.nodes) {
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y + node.h).toBeLessThanOrEqual(full.height);
      expect(node.x + node.w).toBeLessThanOrEqual(full.width);
      if (node.parent < 0) continue;
      const parent = full.nodes[node.parent]!;
      expect(node.x).toBeGreaterThan(parent.x + parent.w);
    }
  });

  it("centers a parent on its children unless it has to move to stay clear", () => {
    const layout = layoutOf(levelExpansion(index, "lists", "all"));
    const root = layout.nodes[0]!;
    const groups = layout.nodes.filter((node) => node.parent === 0);
    const middle = (groups[0]!.y + groups[0]!.h / 2 + (groups[1]!.y + groups[1]!.h / 2)) / 2;
    expect(root.y + root.h / 2).toBeCloseTo(middle);
  });

  it("hides everything under a collapsed node, and only that", () => {
    const open = levelExpansion(index, "all", "all");
    const before = layoutOf(open);
    const closed = new Set(open);
    closed.delete("X");
    const after = layoutOf(closed);
    const under = (id: string) => pathToRoot(index, id).includes("X") && id !== "X";
    const catalogId = (id: string) => id.split("|")[0]!;
    expect(after.positions.has("X")).toBe(true);
    expect(after.nodes.some((node) => under(catalogId(node.id)))).toBe(false);
    const expectedGone = before.nodes.filter((node) => under(catalogId(node.id))).length;
    expect(after.nodes.length).toBe(before.nodes.length - expectedGone);
    expect(after.positions.has("C")).toBe(true);
  });

  it("keeps the subtree bounds right, so a window can skip them", () => {
    for (const [position, node] of full.nodes.entries()) {
      if (node.parent >= 0) {
        const parent = full.nodes[node.parent]!;
        expect(parent.top).toBeLessThanOrEqual(node.top);
        expect(parent.bottom).toBeGreaterThanOrEqual(node.bottom);
        expect(parent.right).toBeGreaterThanOrEqual(node.right);
        expect(node.parent).toBeLessThan(position);
        expect(parent.end).toBeGreaterThanOrEqual(node.end);
      }
    }
  });
});

describe("levelExpansion", () => {
  it("lists: the root and groups, so every list shows closed", () => {
    const layout = layoutOf(levelExpansion(index, "lists", "all"));
    expect(layout.nodes.map((node) => node.id)).toEqual(["root", "gL", "C", "X", "G", "gH", "N", "H", "T", "O:leetcode-75"]);
  });

  it("steps: opens the lists too, but the dictionary stays closed", () => {
    const open = levelExpansion(index, "steps", "all");
    expect(open.has("X")).toBe(true);
    expect(open.has("X1")).toBe(false);
    expect(open.has("G")).toBe(false);
  });

  it("all: opens everything except the dictionary", () => {
    const open = levelExpansion(index, "all", "all");
    expect(open.has("X1")).toBe(true);
    expect(open.has("G")).toBe(false);
    expect(open.has("L0")).toBe(false);
  });

  it("scoped to the dictionary, its lists count as the lists", () => {
    expect(levelExpansion(index, "lists", "dictionary").has("G")).toBe(true);
    expect(levelExpansion(index, "lists", "dictionary").has("L0")).toBe(false);
    expect(levelExpansion(index, "steps", "dictionary").has("L0")).toBe(true);
    expect(levelExpansion(index, "all", "dictionary").size).toBeGreaterThan(levelExpansion(index, "all", "all").size);
  });
});

describe("only", () => {
  const blocks: Exclude<PlanOnly, "all">[] = PLAN_ONLY.filter((only): only is Exclude<PlanOnly, "all"> => only !== "all");

  it.each(blocks)("%s shows the way to its list and nothing beside it", (only) => {
    const layout = layoutOf(levelExpansion(index, "all", only), only);
    const target = planOnlyNode(only)!;
    const path = pathToRoot(index, target);
    for (const node of layout.nodes) {
      const id = node.id.split("|")[0]!;
      expect(path.includes(id) || isInScope(index, id, only)).toBe(true);
    }
    expect(layout.positions.has(target)).toBe(true);
    expect(layout.nodes[layout.positions.get(target)!]!.expanded).toBe(true);
    expect(overlaps(layout)).toEqual([]);
  });

  it("NC150 narrows the NeetCode block to its problems", () => {
    const narrow = layoutOf(levelExpansion(index, "all", "nc150"), "nc150");
    const slugs = new Set(narrow.nodes.flatMap((node) => (node.slug ? [node.slug] : [])));
    expect(slugs.size).toBe(planListSets().nc150.length);
    const wide = layoutOf(levelExpansion(index, "all", "nc250"), "nc250");
    expect(new Set(wide.nodes.flatMap((node) => (node.slug ? [node.slug] : []))).size).toBe(planListSets().nc250.length);
  });

  it("leaves leetcode.cn-only problems out for English readers", () => {
    const layout = layoutOf(everything(), "all", "en");
    const { problems } = index.catalog;
    expect(layout.nodes.some((node) => node.slug && problems[node.slug]?.cnOnly)).toBe(false);
    expect(layoutOf(everything(), "all", "zh").nodes.some((node) => node.slug && problems[node.slug]?.cnOnly)).toBe(true);
  });
});

describe("planMapInWindow", () => {
  const full = layoutOf(everything());

  it("returns exactly the nodes a window touches, skipping whole subtrees", () => {
    const win = { x: full.width / 3, y: full.height / 2, w: 1600, h: 900 };
    const { nodes } = planMapInWindow(full, win);
    const expected = full.nodes.filter(
      (node) => node.y + node.h >= win.y && node.y <= win.y + win.h && node.x + node.w >= win.x && node.x <= win.x + win.w,
    );
    expect(nodes.map((node) => node.id).sort()).toEqual(expected.map((node) => node.id).sort());
    expect(nodes.length).toBeLessThan(200);
  });

  it("draws a connector that crosses the window with both ends outside", () => {
    const layout = layoutOf(levelExpansion(index, "lists", "all"));
    const root = layout.nodes[0]!;
    const child = layout.nodes[layout.positions.get("gH")!]!;
    const y1 = root.y + root.h / 2;
    const y2 = child.y + child.h / 2;
    const win = { x: root.x + root.w + 1, y: (y1 + y2) / 2, w: child.x - root.x - root.w - 2, h: 1 };
    const { nodes, edges } = planMapInWindow(layout, win);
    expect(nodes).toEqual([]);
    expect(edges).toContain(`M${root.x + root.w} ${y1}C`);
  });
});

describe("planMapCounts", () => {
  it("makes the root the Total meter's number, in both languages", () => {
    for (const language of ["en", "zh"] as const) {
      const main = planListSets(language).main;
      const statuses: Record<string, PlanStatusEntryDto> = { [main[0]!]: { status: "solved", ticked: true } };
      const counts = planMapCounts(index, statesFor(language, "all", statuses), statuses, "all");
      expect(counts.get("root")).toEqual({ solved: 1, total: main.length });
    }
  });

  it("counts the scoped list above it", () => {
    const counts = planMapCounts(index, statesFor("zh", "nc150"), {}, "nc150");
    expect(counts.get("root")?.total).toBe(planListSets().nc150.length);
    expect(counts.get("gH")?.total).toBe(planListSets().nc150.length);
  });
});

describe("searchPlanMap", () => {
  const states = statesFor();

  it("finds a problem by number everywhere it's listed, opening the way to the first", () => {
    const result = searchPlanMap({ index, states, query: "42", cap: 60 });
    expect(result.total).toBeGreaterThan(1);
    expect([...result.hits].every((id) => id.endsWith("|trapping-rain-water"))).toBe(true);
    const layout = layoutPlanMap({ index, states, expanded: result.open, only: "all" });
    for (const id of result.hits) expect(layout.positions.has(id)).toBe(true);
    expect(result.first).not.toContain("G");
  });

  it("finds sections by name, and caps what it opens", () => {
    const result = searchPlanMap({ index, states, query: "Sliding Window", cap: 5 });
    expect(result.hits.size).toBe(5);
    expect(result.total).toBeGreaterThan(5);
    expect([...result.hits].some((id) => !id.includes("|"))).toBe(true);
  });

  it("ignores spaces and case, and finds nothing for nothing", () => {
    expect(searchPlanMap({ index, states, query: "TRAPPING  rain", cap: 60 }).total).toBeGreaterThan(0);
    expect(searchPlanMap({ index, states, query: "   ", cap: 60 }).first).toBeNull();
    expect(searchPlanMap({ index, states, query: "zzzzqq", cap: 60 }).total).toBe(0);
  });
});

describe("moving around", () => {
  it("zooming keeps the point under the pointer still", () => {
    const view = { z: 1, tx: 30, ty: -40 };
    const next = zoomPlanMapAt(view, 2, 200, 100);
    expect((200 - next.tx) / next.z).toBeCloseTo((200 - view.tx) / view.z);
    expect((100 - next.ty) / next.z).toBeCloseTo((100 - view.ty) / view.z);
    expect(zoomPlanMapAt(view, 0.001, 0, 0).z).toBe(PLAN_MAP_ZOOM_MIN);
  });

  it("can't lose the map off screen", () => {
    const size = { w: 1000, h: 600 };
    const map = { width: 2000, height: 3000 };
    const far = clampPlanMapView({ z: 1, tx: 99999, ty: -99999 }, size, map);
    expect(far.tx).toBe(920);
    expect(far.ty).toBe(80 - 3000);
  });

  it("fit stops at the smallest zoom when a map is too tall, still centered", () => {
    const fitted = fitPlanMapView({ w: 1000, h: 600 }, { width: 2000, height: 100000 });
    expect(fitted.z).toBe(PLAN_MAP_ZOOM_MIN);
    expect(fitted.ty + (100000 * fitted.z) / 2).toBeCloseTo(300);
  });
});

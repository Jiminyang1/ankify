import { describe, expect, it } from "vitest";
import { findOfficialStudyPlan } from "@ankify/core";
import { ROADMAP_EDGES, ROADMAP_NODES, roadmapLayout } from "./roadmap-layout";

describe("Top Interview 150 layout", () => {
  const names = findOfficialStudyPlan("top-interview-150")!.groups.map((group) => group.name);

  it("places every study-plan group and nothing else", () => {
    expect(Object.keys(ROADMAP_NODES).sort()).toEqual([...names].sort());
  });

  it("only connects placed groups, top to bottom", () => {
    for (const [from, to] of ROADMAP_EDGES) {
      expect(ROADMAP_NODES[from], from).toBeDefined();
      expect(ROADMAP_NODES[to], to).toBeDefined();
      expect(ROADMAP_NODES[to]!.row).toBeGreaterThan(ROADMAP_NODES[from]!.row);
    }
  });

  it("never stacks two nodes in the same slot", () => {
    const slots = Object.values(ROADMAP_NODES).map((node) => `${node.row}:${node.x}`);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it("puts groups it doesn't know on an extra row", () => {
    const layout = roadmapLayout("top-interview-150", [...names, "New Group"]);
    expect(layout.positions.get("New Group")).toEqual({ x: 0.5, row: 9 });
    expect(layout.rows).toBe(10);
  });
});

describe("path layout for other plans", () => {
  it("snakes three per row and links each step in order", () => {
    const layout = roadmapLayout("leetcode-75", ["a", "b", "c", "d", "e"]);
    expect([...layout.positions]).toEqual([
      ["a", { x: 0.2, row: 0 }],
      ["b", { x: 0.5, row: 0 }],
      ["c", { x: 0.8, row: 0 }],
      ["d", { x: 0.8, row: 1 }],
      ["e", { x: 0.5, row: 1 }],
    ]);
    expect(layout.rows).toBe(2);
    expect(layout.edges).toEqual([
      { from: "a", to: "b", kind: "side" },
      { from: "b", to: "c", kind: "side" },
      { from: "c", to: "d", kind: "down" },
      { from: "d", to: "e", kind: "side" },
    ]);
  });
});

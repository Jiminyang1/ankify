import { describe, expect, it } from "vitest";
import { STUDY_PLAN } from "@ankify/core";
import { ROADMAP_EDGES, ROADMAP_NODES, roadmapLayout } from "./roadmap-layout";

describe("roadmap layout", () => {
  const names = STUDY_PLAN.groups.map((group) => group.name);

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
    const layout = roadmapLayout([...names, "New Group"]);
    expect(layout.positions.get("New Group")).toEqual({ x: 0.5, row: 9 });
    expect(layout.rows).toBe(10);
  });
});

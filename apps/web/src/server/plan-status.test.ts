import { describe, expect, it } from "vitest";
import { planStatusContext, type PlanStatusRow } from "./plan-status";

const now = new Date("2026-11-01T00:00:00.000Z");
const row = (slug: string, overrides: Partial<PlanStatusRow> = {}): PlanStatusRow => ({
  id: `id-${slug}`,
  leetcodeSlug: slug,
  archivedAt: null,
  fsrsDue: new Date("2026-12-01T00:00:00.000Z"),
  fsrsLapses: 0,
  ...overrides,
});
const leetcode = { username: "me", profile: { recentAccepted: [{ slug: "recent" }] } } as never;
const solved = { username: "ME", slugs: ["synced", "both"], syncedAt: now.toISOString() };

const context = () =>
  planStatusContext({
    rows: [
      row("remembered"),
      row("due", { fsrsDue: new Date("2026-10-01T00:00:00.000Z") }),
      row("archived", { archivedAt: now }),
      row("ticked-in-deck"),
    ],
    solved,
    leetcode,
    ticks: new Set(["ticked", "both", "ticked-in-deck"]),
    now,
  });

describe("planStatusContext", () => {
  it("counts a tick as solved and done", () => {
    const status = context();
    expect(status.statusOf("ticked")).toBe("solved");
    expect(status.isDone("ticked")).toBe(true);
    expect(status.statusOf("never")).toBe("todo");
    expect(status.isDone("never")).toBe(false);
  });

  it("never lets a tick override the deck or LeetCode", () => {
    const status = context();
    expect(status.statusOf("ticked-in-deck")).toBe("remembered");
    expect(status.statusOf("both")).toBe("solved");
  });

  it("keeps a LeetCode-solved problem solved without a tick", () => {
    const unticked = planStatusContext({ rows: [], solved, leetcode, ticks: new Set(), now });
    expect(unticked.statusOf("both")).toBe("solved");
    expect(unticked.statusOf("recent")).toBe("solved");
  });

  it("ignores a solved list from another LeetCode account", () => {
    const other = planStatusContext({
      rows: [],
      solved: { ...solved, username: "someone-else" },
      leetcode,
      ticks: new Set(),
      now,
    });
    expect(other.statusOf("synced")).toBe("todo");
    expect(other.solvedSync).toBeNull();
    expect(other.statusOf("recent")).toBe("solved");
  });

  it("lists non-todo problems with what can be unticked", () => {
    expect(context().entries()).toEqual({
      remembered: { status: "remembered", problemId: "id-remembered", auto: true },
      due: { status: "due", problemId: "id-due", auto: true },
      archived: { status: "solved", problemId: "id-archived", auto: true },
      "ticked-in-deck": { status: "remembered", problemId: "id-ticked-in-deck", ticked: true, auto: true },
      recent: { status: "solved", auto: true },
      synced: { status: "solved", auto: true },
      both: { status: "solved", ticked: true, auto: true },
      ticked: { status: "solved", ticked: true },
    });
  });
});

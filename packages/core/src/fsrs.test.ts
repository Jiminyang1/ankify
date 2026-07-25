import { describe, expect, it } from "vitest";
import { FSRSVersion } from "ts-fsrs";
import { emptyCardState, preview, rate, retrievability } from "./fsrs";

describe("FSRS-6 wrapper", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");

  it("returns stable first-review previews", () => {
    const state = emptyCardState(now);

    expect(state).toMatchObject({
      state: "new",
      reps: 0,
      lapses: 0,
      learningSteps: 0,
    });
    expect(preview(state, now)).toEqual({
      1: { due: "2026-01-01T00:01:00.000Z" },
      2: { due: "2026-01-01T00:06:00.000Z" },
      3: { due: "2026-01-01T00:10:00.000Z" },
      4: { due: "2026-01-10T00:00:00.000Z" },
    });
  });

  it("persists FSRS-6 learning step progress", () => {
    const first = rate(emptyCardState(now), 3, now).next;

    expect(first).toMatchObject({
      state: "learning",
      reps: 1,
      learningSteps: 1,
      scheduledDays: 0,
    });
    expect(first.due?.toISOString()).toBe("2026-01-01T00:10:00.000Z");

    const graduated = rate(first, 3, first.due!).next;
    expect(graduated).toMatchObject({ state: "review", reps: 2, learningSteps: 0 });
    expect(graduated.due!.getTime()).toBeGreaterThan(first.due!.getTime());
  });

  it("treats new cards as fully retrievable without mutating state", () => {
    const state = emptyCardState(now);
    const before = structuredClone(state);

    expect(retrievability(state, new Date("2026-02-01T00:00:00.000Z"))).toBe(1);
    expect(state).toEqual(before);
  });
});
  it("runs the FSRS-6 scheduler promised by the product", () => {
    expect(FSRSVersion).toContain("FSRS-6.0");
  });

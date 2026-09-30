import { describe, expect, it } from "vitest";
import { FSRSVersion } from "ts-fsrs";
import {
  clampInitialReviewDelayHours,
  emptyCardState,
  initialReviewDue,
  preview,
  previewFullSolve,
  rate,
  rateFullSolve,
  retrievability,
  retrievabilityEstimate,
  SCHEDULING_POLICIES,
} from "./fsrs";

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

describe("leetcode_full_solve_v1", () => {
  const completedAt = new Date("2026-09-29T12:00:00.000Z");
  const day = 86_400_000;
  const daysUntil = (due: Date | null, from: Date) => (due!.getTime() - from.getTime()) / day;

  it("schedules the first review a bounded delay after initial learning, without a rating", () => {
    expect(initialReviewDue(completedAt, 24).toISOString()).toBe("2026-09-30T12:00:00.000Z");
    expect(initialReviewDue(completedAt, 0).getTime() - completedAt.getTime()).toBe(3_600_000);
    expect(initialReviewDue(completedAt, 1_000).getTime() - completedAt.getTime()).toBe(168 * 3_600_000);
    expect(clampInitialReviewDelayHours("48")).toBe(24);
    expect(clampInitialReviewDelayHours(47.6)).toBe(48);
    expect(SCHEDULING_POLICIES).toMatchObject({ initialDelay: "initial_delay_v1", leetcodeFullSolve: "leetcode_full_solve_v1" });
  });

  it("gives every grade of a first review a day-based interval", () => {
    const initialized = { ...emptyCardState(completedAt), due: initialReviewDue(completedAt, 24) };
    const reviewedAt = initialized.due!;
    const outcomes = ([1, 2, 3, 4] as const).map((rating) => rateFullSolve(initialized, rating, reviewedAt).next);
    for (const next of outcomes) {
      expect(next).toMatchObject({ state: "review", reps: 1, learningSteps: 0 });
      expect(next.scheduledDays).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(daysUntil(next.due, reviewedAt))).toBe(true);
    }
    const intervals = outcomes.map((next) => next.scheduledDays!);
    expect(intervals).toEqual([...intervals].sort((a, b) => a - b));
    expect(new Set(Object.values(previewFullSolve(initialized, reviewedAt)).map((outcome) => outcome.due)).size).toBe(4);
  });

  it("moves legacy learning and relearning states to day-based review intervals", () => {
    const learning = rate(emptyCardState(completedAt), 1, completedAt).next;
    expect(learning).toMatchObject({ state: "learning" });
    const later = new Date(completedAt.getTime() + day);
    expect(rateFullSolve(learning, 3, later).next).toMatchObject({ state: "review" });
    expect(daysUntil(rateFullSolve(learning, 3, later).next.due, later)).toBeGreaterThanOrEqual(1);

    const review = rateFullSolve(emptyCardState(completedAt), 3, completedAt).next;
    const lapse = rateFullSolve(review, 1, review.due!).next;
    expect(lapse).toMatchObject({ state: "review", lapses: 1 });
    expect(daysUntil(lapse.due, review.due!)).toBeGreaterThanOrEqual(1);
  });

  it("schedules a delayed rating from the completion time, not the rating time", () => {
    const review = rateFullSolve(emptyCardState(completedAt), 3, completedAt).next;
    const reviewedAt = review.due!;
    const sameMoment = rateFullSolve(review, 3, reviewedAt).next;
    expect(rateFullSolve(review, 3, reviewedAt).next).toEqual(sameMoment);
    expect(sameMoment.lastReview).toEqual(reviewedAt);
  });

  it("reports an unreviewed problem's recall as not yet estimated", () => {
    expect(retrievabilityEstimate(emptyCardState(completedAt), completedAt)).toBeNull();
    const review = rateFullSolve(emptyCardState(completedAt), 3, completedAt).next;
    expect(retrievabilityEstimate(review, review.due!)).toBeGreaterThan(0.85);
  });
});

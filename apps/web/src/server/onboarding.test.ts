import { describe, expect, it } from "vitest";
import {
  completeOnboardingWhenReady,
  normalizeOnboardingSettings,
  onboardingReady,
} from "./onboarding";

describe("onboarding state", () => {
  it("normalizes untrusted stored values", () => {
    expect(
      normalizeOnboardingSettings({
        aiChoice: "invalid",
        planChosenAt: "soon",
        extensionConnectedAt: "not-a-date",
        firstCaptureAt: "2026-07-27T00:00:00.000Z",
      }),
    ).toEqual({
      aiChoice: "not_started",
      planChosenAt: undefined,
      extensionConnectedAt: undefined,
      aiVerifiedAt: undefined,
      firstCaptureAt: "2026-07-27T00:00:00.000Z",
      firstReviewAt: undefined,
      completedAt: undefined,
    });
  });

  it("allows skipping AI without blocking onboarding completion", () => {
    const now = new Date("2026-07-27T01:00:00.000Z");
    expect(
      completeOnboardingWhenReady(
        {
          aiChoice: "skipped",
          planChosenAt: "2026-07-27T00:00:00.000Z",
          extensionConnectedAt: "2026-07-27T00:00:00.000Z",
          firstCaptureAt: "2026-07-27T00:10:00.000Z",
          firstReviewAt: "2026-07-27T00:30:00.000Z",
        },
        now,
      ).completedAt,
    ).toBe(now.toISOString());
  });

  it("does not complete before the user handles the AI choice", () => {
    expect(
      completeOnboardingWhenReady(
        {
          aiChoice: "not_started",
          planChosenAt: "2026-07-27T00:00:00.000Z",
          extensionConnectedAt: "2026-07-27T00:00:00.000Z",
          firstCaptureAt: "2026-07-27T00:10:00.000Z",
          firstReviewAt: "2026-07-27T00:30:00.000Z",
        },
        new Date("2026-07-27T01:00:00.000Z"),
      ).completedAt,
    ).toBeUndefined();
  });

  it("waits for a plan choice when the first review came after the plan step", () => {
    const steps = {
      aiChoice: "skipped" as const,
      extensionConnectedAt: "2026-11-02T00:00:00.000Z",
      firstCaptureAt: "2026-11-02T00:10:00.000Z",
      firstReviewAt: "2026-11-03T00:30:00.000Z",
    };
    expect(onboardingReady(steps)).toBe(false);
    expect(onboardingReady({ ...steps, planChosenAt: "2026-11-02T00:05:00.000Z" })).toBe(true);
  });

  it("doesn't hold open the checklist of someone who reviewed before the plan step", () => {
    expect(
      onboardingReady({
        aiChoice: "configured",
        extensionConnectedAt: "2026-09-01T00:00:00.000Z",
        firstCaptureAt: "2026-09-01T00:10:00.000Z",
        firstReviewAt: "2026-09-02T00:30:00.000Z",
      }),
    ).toBe(true);
  });

  it("still needs the other steps once a plan is chosen", () => {
    expect(
      onboardingReady({
        aiChoice: "skipped",
        planChosenAt: "2026-11-02T00:00:00.000Z",
        extensionConnectedAt: "2026-11-02T00:00:00.000Z",
        firstCaptureAt: "2026-11-02T00:10:00.000Z",
      }),
    ).toBe(false);
  });
});

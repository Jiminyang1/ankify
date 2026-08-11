import { describe, expect, it } from "vitest";
import {
  completeOnboardingWhenReady,
  normalizeOnboardingSettings,
} from "./onboarding";

describe("onboarding state", () => {
  it("normalizes untrusted stored values", () => {
    expect(
      normalizeOnboardingSettings({
        aiChoice: "invalid",
        extensionConnectedAt: "not-a-date",
        firstCaptureAt: "2026-07-27T00:00:00.000Z",
      }),
    ).toEqual({
      aiChoice: "not_started",
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
          extensionConnectedAt: "2026-07-27T00:00:00.000Z",
          firstCaptureAt: "2026-07-27T00:10:00.000Z",
          firstReviewAt: "2026-07-27T00:30:00.000Z",
        },
        new Date("2026-07-27T01:00:00.000Z"),
      ).completedAt,
    ).toBeUndefined();
  });
});

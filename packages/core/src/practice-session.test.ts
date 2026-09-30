import { describe, expect, it } from "vitest";
import {
  classifyObservation,
  compareSubmissionIds,
  effectiveRatingDisposition,
  effectiveSessionStatus,
  END_GRACE_MS,
  isSessionStale,
  mergeOwnerTiming,
  normalizeClientTime,
  ownershipFor,
  ratingDispositionOnCompletion,
  SESSION_LEASE_MS,
  SESSION_STALE_AFTER_MS,
  sessionKindFor,
} from "./practice-session";

const now = new Date("2026-09-29T12:00:00.000Z");
const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);
const lease = (overrides: Partial<Parameters<typeof effectiveSessionStatus>[0]> = {}) => ({
  status: "active" as const,
  isOpen: true,
  ownerToken: "tab-a",
  ownerLeaseExpiresAt: at(SESSION_LEASE_MS),
  lastActivityAt: now,
  ...overrides,
});

describe("session lifecycle", () => {
  it("reads an active session without a live lease as interrupted, never as failed", () => {
    expect(effectiveSessionStatus(lease(), now)).toBe("active");
    expect(effectiveSessionStatus(lease({ ownerLeaseExpiresAt: now }), now)).toBe("interrupted");
    expect(effectiveSessionStatus(lease({ ownerLeaseExpiresAt: null }), now)).toBe("interrupted");
    expect(effectiveSessionStatus(lease({ status: "completed", ownerLeaseExpiresAt: null }), now)).toBe("completed");
  });

  it("marks open sessions inactive for more than 24 hours as stale", () => {
    expect(isSessionStale(lease({ lastActivityAt: at(-SESSION_STALE_AFTER_MS) }), now)).toBe(false);
    expect(isSessionStale(lease({ lastActivityAt: at(-SESSION_STALE_AFTER_MS - 1) }), now)).toBe(true);
    expect(isSessionStale(lease({ isOpen: false, lastActivityAt: at(-SESSION_STALE_AFTER_MS - 1) }), now)).toBe(false);
  });

  it("lets only the owner act while its lease lives, and anyone claim it afterwards", () => {
    expect(ownershipFor(lease(), "tab-a", now)).toBe("owner");
    expect(ownershipFor(lease(), "tab-b", now)).toBe("owned_elsewhere");
    expect(ownershipFor(lease({ ownerLeaseExpiresAt: at(-1) }), "tab-b", now)).toBe("claimable");
    // The owner keeps its token after a sleep longer than the lease.
    expect(ownershipFor(lease({ ownerLeaseExpiresAt: at(-1) }), "tab-a", now)).toBe("owner");
  });

  it("rates only scheduled reviews", () => {
    expect(ratingDispositionOnCompletion("scheduled_review")).toBe("pending");
    expect(ratingDispositionOnCompletion("voluntary_practice")).toBe("not_applicable");
    expect(ratingDispositionOnCompletion("initial_learning")).toBe("not_applicable");
  });

  it("supersedes a pending rating after any scheduling change and expires it after its window", () => {
    const pending = { ratingDisposition: "pending" as const, ratingExpiresAt: at(1), scheduleRevisionAtStart: 4 };
    expect(effectiveRatingDisposition(pending, 4, now)).toBe("pending");
    expect(effectiveRatingDisposition({ ...pending, ratingDisposition: "deferred" }, 4, now)).toBe("deferred");
    expect(effectiveRatingDisposition(pending, 5, now)).toBe("superseded");
    expect(effectiveRatingDisposition({ ...pending, ratingExpiresAt: now }, 4, now)).toBe("expired");
    expect(effectiveRatingDisposition({ ...pending, ratingDisposition: "submitted" }, 5, now)).toBe("submitted");
  });
});

describe("session kind", () => {
  const enrolled = (due: boolean) => ({ enrollment: "enrolled" as const, due });
  it("starts initial learning for problems new to Ankify or never initialized", () => {
    expect(sessionKindFor("practice", null)).toEqual({ type: "initial_learning", reviewIntent: "none" });
    expect(sessionKindFor("practice", { enrollment: "awaiting_initial", due: false })).toEqual({ type: "initial_learning", reviewIntent: "none" });
    expect(sessionKindFor("due_review", null)).toEqual({ error: "problem_not_found" });
    expect(sessionKindFor("early_review", { enrollment: "awaiting_initial", due: false })).toEqual({ error: "not_enrolled" });
  });

  it("keeps ordinary practice voluntary and requires an explicit review choice", () => {
    expect(sessionKindFor("practice", enrolled(true))).toEqual({ type: "voluntary_practice", reviewIntent: "none" });
    expect(sessionKindFor("due_review", enrolled(true))).toEqual({ type: "scheduled_review", reviewIntent: "due" });
    expect(sessionKindFor("due_review", enrolled(false))).toEqual({ error: "not_due" });
    expect(sessionKindFor("early_review", enrolled(false))).toEqual({ type: "scheduled_review", reviewIntent: "early" });
    expect(sessionKindFor("early_review", enrolled(true))).toEqual({ type: "scheduled_review", reviewIntent: "due" });
  });
});

describe("submission ids and observation placement", () => {
  it("compares decimal ids numerically, not lexically", () => {
    expect(compareSubmissionIds("999", "1000")).toBe(-1);
    expect(compareSubmissionIds("1000", "999")).toBe(1);
    expect(compareSubmissionIds("0042", "42")).toBe(0);
    expect(compareSubmissionIds("12a", "13")).toBeNull();
  });

  type SessionView = Parameters<typeof classifyObservation>[0];
  const session: SessionView = {
    startedAt: now,
    completedAt: null,
    baselineState: "established",
    baselineSubmissionId: "1000",
  };
  const place = (overrides: Partial<SessionView>, leetcodeSubmissionId: string | null, submittedAt: Date | null) =>
    classifyObservation({ ...session, ...overrides }, { leetcodeSubmissionId, submittedAt });

  it("uses LeetCode's submission time when it is clearly inside or outside the session", () => {
    expect(place({}, "1001", at(5_000))).toBe("in_session");
    expect(place({}, "1001", at(-1_000))).toBe("in_session");
    expect(place({}, "999", at(-60_000))).toBe("outside_session");
    expect(place({ completedAt: at(10_000) }, "1003", at(10_000 + END_GRACE_MS))).toBe("in_session");
    expect(place({ completedAt: at(10_000) }, "1004", at(10_001 + END_GRACE_MS))).toBe("outside_session");
  });

  it("resolves submissions around the start with the baseline, else keeps them ambiguous", () => {
    expect(place({}, "1001", at(-10_000))).toBe("in_session");
    expect(place({}, "1000", at(-10_000))).toBe("outside_session");
    expect(place({ baselineState: "pending", baselineSubmissionId: null }, "1001", at(-10_000))).toBe("ambiguous");
    expect(place({ baselineState: "none", baselineSubmissionId: null }, "5", at(-10_000))).toBe("in_session");
  });

  it("flags contradictions and unplaceable observations as ambiguous", () => {
    expect(place({}, "1001", at(-3_600_000))).toBe("ambiguous");
    expect(place({ baselineState: "none", baselineSubmissionId: null }, "5", at(-3_600_000))).toBe("ambiguous");
    expect(place({}, null, null)).toBe("ambiguous");
    expect(place({ baselineState: "unavailable", baselineSubmissionId: null }, "1001", null)).toBe("ambiguous");
  });

  it("places time-less observations by the baseline", () => {
    expect(place({}, "1001", null)).toBe("in_session");
    expect(place({}, "1000", null)).toBe("outside_session");
    expect(place({ baselineState: "none", baselineSubmissionId: null }, "1", null)).toBe("in_session");
  });
});

describe("client time and timing", () => {
  const bounds = { min: at(-60_000), max: now };
  it("keeps plausible client times and marks clamped or missing ones as adjusted", () => {
    expect(normalizeClientTime(at(-30_000), bounds)).toEqual({ at: at(-30_000), adjusted: false });
    expect(normalizeClientTime(at(-120_000), bounds)).toEqual({ at: bounds.min, adjusted: true });
    expect(normalizeClientTime(at(5_000), bounds)).toEqual({ at: now, adjusted: true });
    expect(normalizeClientTime(null, bounds)).toEqual({ at: now, adjusted: true });
    expect(normalizeClientTime(new Date("invalid"), bounds)).toEqual({ at: now, adjusted: true });
  });

  it("merges cumulative reports with max so replays and reordering never double count", () => {
    const limits = { committedObservedMs: 0, startedAt: at(-600_000), now };
    const first = mergeOwnerTiming({ ownerActiveMs: 0, ownerObservedMs: 0 }, { activeMs: 100_000, observedMs: 200_000 }, limits);
    expect(first).toEqual({ ownerActiveMs: 100_000, ownerObservedMs: 200_000 });
    expect(mergeOwnerTiming(first, { activeMs: 100_000, observedMs: 200_000 }, limits)).toEqual(first);
    expect(mergeOwnerTiming(first, { activeMs: 50_000, observedMs: 150_000 }, limits)).toEqual(first);
  });

  it("caps observed time by wall time and active time by observed time", () => {
    const limits = { committedObservedMs: 400_000, startedAt: at(-600_000), now };
    expect(mergeOwnerTiming({ ownerActiveMs: 0, ownerObservedMs: 0 }, { activeMs: 900_000, observedMs: 900_000 }, limits))
      .toEqual({ ownerActiveMs: 205_000, ownerObservedMs: 205_000 });
  });
});

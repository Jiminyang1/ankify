import { describe, expect, it } from "vitest";
import {
  computeMistakeProfile,
  summarizeSession,
  type ProfileInput,
  type ProfileMistakeInput,
  type ProfileSessionInput,
} from "./profile";

const now = new Date("2026-09-30T12:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

let id = 0;
function mistake(overrides: Partial<ProfileMistakeInput> = {}): ProfileMistakeInput {
  id += 1;
  return {
    id: `m${id}`,
    problemId: "p1",
    topics: ["Array"],
    category: "edge_case",
    status: "confirmed",
    origin: "user",
    resolved: false,
    createdAt: daysAgo(1),
    practiceSessionId: null,
    legacySourceKey: `record:m${id}`,
    ...overrides,
  };
}

function session(overrides: Partial<ProfileSessionInput> = {}): ProfileSessionInput {
  id += 1;
  return {
    id: `s${id}`,
    problemId: "p1",
    topics: ["Array"],
    status: "completed",
    outcome: "accepted",
    completedAt: daysAgo(1),
    rating: null,
    verdicts: [],
    partialCapture: false,
    ambiguousObservations: 0,
    ...overrides,
  };
}

const profile = (input: Partial<ProfileInput>) =>
  computeMistakeProfile({ now, sessions: [], mistakes: [], legacyRatings: [], ...input });
const category = (result: ReturnType<typeof profile>, name: string) => result.categories.find((item) => item.category === name);

describe("mistake profile", () => {
  it("counts a session once per dimension, however many records or origins it has", () => {
    const single = profile({ mistakes: [mistake({ practiceSessionId: "s-1" })] });
    const tripled = profile({
      mistakes: [
        mistake({ practiceSessionId: "s-1", legacySourceKey: "submission:a" }),
        mistake({ practiceSessionId: "s-1", legacySourceKey: "submission:b" }),
        mistake({ practiceSessionId: "s-1", origin: "ai_suggested" }),
      ],
    });
    expect(category(tripled, "edge_case")).toMatchObject({ contexts: 1, unresolved: 3 });
    expect(category(tripled, "edge_case")!.weakness).toBeCloseTo(category(single, "edge_case")!.weakness, 10);
  });

  it("keeps each legacy source as its own context without inventing sessions", () => {
    const result = profile({
      mistakes: [
        mistake({ legacySourceKey: "submission:a" }),
        mistake({ legacySourceKey: "submission:a" }),
        mistake({ legacySourceKey: "quiz:q1:i2", problemId: "p2" }),
      ],
    });
    expect(category(result, "edge_case")).toMatchObject({ contexts: 2, problems: 2, ready: true });
    expect(result.readiness).toMatchObject({ completedSessions: 0, personalized: false });
  });

  it("lists unconfirmed AI candidates apart and never weighs them or dismissed records", () => {
    const candidate = mistake({ status: "candidate", origin: "ai_suggested", category: "invariant" });
    const result = profile({ mistakes: [candidate, mistake({ status: "dismissed", category: "complexity" })] });
    expect(result.candidateIds).toEqual([candidate.id]);
    expect(result.categories).toEqual([]);
  });

  it("targets only after three completed sessions across two problems, and a dimension after two contexts across two problems", () => {
    const sessions = [session({ problemId: "p1" }), session({ problemId: "p1" })];
    expect(profile({ sessions }).readiness).toEqual({ completedSessions: 2, distinctProblems: 1, personalized: false });
    expect(profile({ sessions: [...sessions, session({ problemId: "p2" })] }).readiness.personalized).toBe(true);

    const oneProblem = profile({ mistakes: [mistake({ practiceSessionId: "a" }), mistake({ practiceSessionId: "b" })] });
    expect(category(oneProblem, "edge_case")).toMatchObject({ contexts: 2, problems: 1, ready: false });
    const twoProblems = profile({ mistakes: [mistake({ practiceSessionId: "a" }), mistake({ practiceSessionId: "b", problemId: "p2" })] });
    expect(category(twoProblems, "edge_case")).toMatchObject({ ready: true, weak: true });
  });

  it("treats Accepted and Good ratings on other problems as topic success, never as mastery of a dimension", () => {
    const mistakes = [mistake({ practiceSessionId: "a" })];
    const withSuccess = profile({ mistakes, sessions: [session({ rating: 4, problemId: "p2" }), session({ rating: 3, problemId: "p2" }), session({ problemId: "p3" })] });
    expect(category(withSuccess, "edge_case")!.weakness).toBeCloseTo(category(profile({ mistakes }), "edge_case")!.weakness, 10);
    const topic = withSuccess.topics.find((item) => item.topic === "Array")!;
    expect(topic).toMatchObject({ sessions: 3, accepted: 3 });
    expect(profile({ sessions: [session({ outcome: "failed" }), session({ outcome: "failed" })] }).topics[0]!.weakness).toBeGreaterThan(topic.weakness);
  });

  it("lowers a dimension through clean reviews: later accepted sessions on its problems without the mistake again", () => {
    const failed = session({ id: "a", outcome: "failed", completedAt: daysAgo(5) });
    const mistakes = [
      mistake({ practiceSessionId: "a", createdAt: daysAgo(4) }),
      mistake({ practiceSessionId: "b", problemId: "p2" }),
      // Still only suggested for session "d": not clean, not counted against.
      mistake({ practiceSessionId: "d", status: "candidate", origin: "ai_suggested" }),
    ];
    const before = category(profile({ mistakes, sessions: [failed] }), "edge_case")!;
    const sessions = [
      failed,
      session({ id: "c", completedAt: daysAgo(1) }), // clean review
      session({ id: "d", completedAt: daysAgo(1) }), // the mistake was suggested again
      session({ id: "e", problemId: "p3", completedAt: daysAgo(1) }), // no mistake on that problem
      session({ id: "f", completedAt: daysAgo(1), rating: 1 }), // rated Again
      session({ id: "g", completedAt: daysAgo(6) }), // before the mistake
      session({ id: "h", completedAt: daysAgo(1), outcome: "failed" }),
    ];
    const after = category(profile({ mistakes, sessions }), "edge_case")!;
    expect(after).toMatchObject({ cleanReviews: 1, contexts: 2 });
    expect(after.weakness).toBeLessThan(before.weakness);
  });

  it("never scores interrupted or abandoned sessions or missing outcomes as failures", () => {
    const result = profile({
      sessions: [session({ status: "interrupted", outcome: null, completedAt: null }), session({ status: "abandoned", outcome: null }), session({ outcome: "unknown" })],
    });
    expect(result.signals.sessions).toEqual({ completed: 1, accepted: 0, failed: 0, unknown: 1, interrupted: 1, abandoned: 1 });
    expect(result.topics[0]).toMatchObject({ sessions: 1, failed: 0 });
    expect(result.readiness.completedSessions).toBe(1);
  });

  it("uses a session's rating when it has one, and its observed outcome when the rating was undone", () => {
    const rated = profile({ sessions: [session({ outcome: "failed", rating: 3 })] });
    const undone = profile({ sessions: [session({ outcome: "failed", rating: null })] });
    expect(rated.signals.ratings).toEqual({ again: 0, hard: 0, good: 1, easy: 0 });
    expect(undone.signals.ratings).toEqual({ again: 0, hard: 0, good: 0, easy: 0 });
    expect(undone.topics[0]!.weakness).toBeGreaterThan(rated.topics[0]!.weakness);
  });

  it("weighs a context of only resolved records at a quarter and drops evidence older than 90 days", () => {
    const open = category(profile({ mistakes: [mistake()] }), "edge_case")!;
    const resolved = category(profile({ mistakes: [mistake({ resolved: true })] }), "edge_case")!;
    expect(resolved.weakness).toBeLessThan(open.weakness);
    expect(resolved).toMatchObject({ resolved: 1, unresolved: 0 });
    expect(profile({ mistakes: [mistake({ createdAt: daysAgo(91) })] }).categories).toEqual([]);
  });

  it("compares confirmed contexts with the previous period and labels incomplete evidence", () => {
    const result = profile({
      mistakes: [mistake({ createdAt: daysAgo(5) }), mistake({ createdAt: daysAgo(40) }), mistake({ createdAt: daysAgo(45) })],
      sessions: [session({ partialCapture: true, ambiguousObservations: 2 })],
    });
    expect(category(result, "edge_case")!.trend).toEqual({ current: 1, previous: 2 });
    expect(result.incomplete).toEqual({ sessionsWithPartialCapture: 1, ambiguousObservations: 2 });
  });
});

describe("session summary", () => {
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
  it("records the correction sequence once per session", () => {
    expect(summarizeSession([
      { verdict: "Accepted", at: at(9) },
      { verdict: "Wrong Answer", at: at(2) },
      { verdict: "Wrong Answer", at: at(4) },
      { verdict: "Time Limit Exceeded", at: at(6) },
      { verdict: "Accepted", at: at(12) },
    ])).toEqual({
      attempts: 5,
      failedBeforeAccepted: 3,
      firstTryAccepted: false,
      firstAcceptedAt: at(9),
      sequence: [
        { verdict: "Wrong Answer", count: 2 },
        { verdict: "Time Limit Exceeded", count: 1 },
        { verdict: "Accepted", count: 2 },
      ],
    });
    expect(summarizeSession([{ verdict: "Accepted", at: at(1) }])).toMatchObject({ firstTryAccepted: true, failedBeforeAccepted: 0 });
    expect(summarizeSession([{ verdict: "Runtime Error", at: at(1) }])).toMatchObject({ failedBeforeAccepted: 1, firstAcceptedAt: null });
  });
});

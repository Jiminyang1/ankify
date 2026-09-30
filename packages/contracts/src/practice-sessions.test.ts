import { describe, expect, it } from "vitest";
import {
  practiceSessionCommandSchema,
  practiceSessionCurrentQuerySchema,
  practiceSessionStartSchema,
  practiceSessionSubmissionsSchema,
} from "./practice-sessions";

const requestId = "11111111-1111-4111-8111-111111111111";
const ownerToken = "22222222-2222-4222-8222-222222222222";
const problem = {
  leetcodeSlug: "two-sum",
  leetcodeId: 1,
  title: "Two Sum",
  difficulty: "Easy",
  url: "https://leetcode.com/problems/two-sum/",
};

describe("practice session contracts", () => {
  it("starts from an Ankify problem or LeetCode metadata, and never supersedes a rating implicitly", () => {
    const fromQueue = practiceSessionStartSchema.parse({ requestId, ownerToken, mode: "due_review", target: { kind: "problem", problemId: "p1" } });
    expect(fromQueue.supersedePendingRating).toBe(false);
    expect(fromQueue.baseline).toBeUndefined();
    const fromPage = practiceSessionStartSchema.parse({
      requestId, ownerToken, mode: "practice", target: { kind: "leetcode", problem },
      baseline: { state: "established", leetcodeSubmissionId: "1234567" }, sourceAccount: "leet_user-1.2",
    });
    expect(fromPage.target).toMatchObject({ kind: "leetcode", problem: { topicTags: [], similarSlugs: [] } });
  });

  it("rejects unknown fields, non-decimal submission ids, and notes or submissions in start metadata", () => {
    const base = { requestId, ownerToken, mode: "practice", target: { kind: "leetcode", problem } };
    expect(practiceSessionStartSchema.safeParse({ ...base, extra: true }).success).toBe(false);
    expect(practiceSessionStartSchema.safeParse({ ...base, baseline: { state: "established", leetcodeSubmissionId: "abc" } }).success).toBe(false);
    expect(practiceSessionStartSchema.safeParse({ ...base, target: { kind: "leetcode", problem: { ...problem, notes: "x" } } }).success).toBe(false);
    expect(practiceSessionStartSchema.safeParse({ ...base, sourceAccount: "bad user" }).success).toBe(false);
  });

  it("requires owner tokens for control commands but not for rating decisions", () => {
    expect(practiceSessionCommandSchema.safeParse({ type: "finish", requestId, result: "solved", occurredAt: "2026-09-29T12:00:00.000Z" }).success).toBe(false);
    expect(practiceSessionCommandSchema.parse({ type: "finish", requestId, ownerToken, result: "solved", occurredAt: "2026-09-29T12:00:00.000Z" }))
      .toMatchObject({ type: "finish", result: "solved" });
    expect(practiceSessionCommandSchema.parse({ type: "defer_rating", requestId })).toEqual({ type: "defer_rating", requestId });
    expect(practiceSessionCommandSchema.safeParse({ type: "heartbeat", ownerToken, activeMs: -1, observedMs: 0 }).success).toBe(false);
    expect(practiceSessionCommandSchema.parse({ type: "heartbeat", ownerToken, activeMs: 10, observedMs: 20, availability: "signed_out" }))
      .toMatchObject({ availability: "signed_out" });
  });

  it("bounds observation batches and requires an identity for each observation", () => {
    const observation = { leetcodeSubmissionId: "9001", verdict: "Accepted" };
    expect(practiceSessionSubmissionsSchema.safeParse({ observations: [] }).success).toBe(false);
    expect(practiceSessionSubmissionsSchema.safeParse({ observations: Array(21).fill(observation) }).success).toBe(false);
    expect(practiceSessionSubmissionsSchema.safeParse({ observations: [{ verdict: "Accepted" }] }).success).toBe(false);
    expect(practiceSessionSubmissionsSchema.safeParse({ observations: [{ clientObservationId: requestId, verdict: "Wrong Answer" }] }).success).toBe(true);
    expect(practiceSessionSubmissionsSchema.parse({ observations: [{ ...observation, detail: { language: "python3", code: "pass" } }] }).observations[0])
      .toMatchObject({ detail: { language: "python3", code: "pass" } });
  });

  it("identifies the current problem by exactly one of problem id or slug", () => {
    expect(practiceSessionCurrentQuerySchema.safeParse({ slug: "two-sum" }).success).toBe(true);
    expect(practiceSessionCurrentQuerySchema.safeParse({ problemId: "p1" }).success).toBe(true);
    expect(practiceSessionCurrentQuerySchema.safeParse({}).success).toBe(false);
    expect(practiceSessionCurrentQuerySchema.safeParse({ slug: "two-sum", problemId: "p1" }).success).toBe(false);
  });
});

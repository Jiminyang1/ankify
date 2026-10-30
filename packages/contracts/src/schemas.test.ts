import { describe, expect, it } from "vitest";
import {
  agentNavigationSchema,
  agentProposalSchema,
  agentSessionPatchSchema,
  agentTurnRequestSchema,
  captureProblemSchema,
  docEditSchema,
  isLegacyCardEdit,
  reviewRatingSchema,
} from "./schemas";

describe("Agent contracts", () => {
  it("keeps the session stable while page context changes between turns", () => {
    const turn = {
      sessionId: "session-1",
      requestId: "14c3fc2b-d67c-49d2-bb7b-28d4210092c4",
      message: "Analyze my latest submission",
      context: { page: "review", activePanel: "submissions", problemId: "problem-1" },
    };
    expect(agentTurnRequestSchema.safeParse(turn).success).toBe(true);
    expect(
      agentTurnRequestSchema.safeParse({
        ...turn,
        sessionId: null,
        context: { page: "today", activePanel: "overview", problemId: null },
      }).success,
    ).toBe(true);
    expect(agentTurnRequestSchema.safeParse({ ...turn, userId: "user-2" }).success).toBe(false);
  });

  it("still loads card and quiz proposals from old runs", () => {
    const stored = agentProposalSchema.parse({
      action: "quiz_next_batch",
      requestId: "14c3fc2b-d67c-49d2-bb7b-28d4210092c4",
      problemId: "problem-1",
      expectedQuizSessionId: "quiz-1",
      reason: "Create a new batch after the completed quiz.",
    });
    expect(stored).toEqual({
      action: "quiz_next_batch",
      problemId: "problem-1",
      reason: "Create a new batch after the completed quiz.",
    });
  });

  it("lets the Coach edit only Notes, while old card proposals still load", () => {
    expect(docEditSchema.safeParse({ op: "append_section", section: "Pitfalls", markdown: "- Off by one." }).success).toBe(true);
    expect(docEditSchema.safeParse({ op: "add_card", prompt: "Why?", answer: "Because." }).success).toBe(false);
    const stored = agentProposalSchema.parse({
      action: "doc_edit",
      problemId: "problem-1",
      edit: { op: "update_card", key: "0123456789abcdef", answer: "New." },
      baseVersion: 2,
      reason: "Clarify the answer.",
    });
    expect(stored.action === "doc_edit" && isLegacyCardEdit(stored.edit)).toBe(true);
  });

  it("keeps navigation inside the saved problem workspace", () => {
    expect(
      agentNavigationSchema.safeParse({
        destination: "review",
        problemId: "problem-1",
      }).success,
    ).toBe(true);
    expect(
      agentNavigationSchema.safeParse({
        destination: "https://example.com",
        problemId: "problem-1",
      }).success,
    ).toBe(false);
  });

  it("accepts a compact session title and rejects empty or oversized titles", () => {
    expect(agentSessionPatchSchema.safeParse({ title: "  Greedy review  " }).data).toEqual({
      title: "Greedy review",
    });
    expect(agentSessionPatchSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(agentSessionPatchSchema.safeParse({ title: "x".repeat(81) }).success).toBe(false);
    expect(agentSessionPatchSchema.safeParse({ title: "Review", status: "archived" }).success).toBe(false);
  });
});

describe("reviewRatingSchema", () => {
  it("validates idempotency ids while accepting legacy clients", () => {
    expect(
      reviewRatingSchema.safeParse({
        problemId: "problem-1",
        rating: 3,
        requestId: "14c3fc2b-d67c-49d2-bb7b-28d4210092c4",
      }).success,
    ).toBe(true);
    expect(reviewRatingSchema.safeParse({ problemId: "problem-1", rating: 3 }).success).toBe(true);
    expect(
      reviewRatingSchema.safeParse({ problemId: "problem-1", rating: 3, requestId: "retry-1" }).success,
    ).toBe(false);
  });
});

describe("public payload limits", () => {
  const baseCapture = {
    leetcodeSlug: "two-sum",
    title: "Two Sum",
    difficulty: "Easy" as const,
    url: "https://leetcode.com/problems/two-sum/",
  };

  it("accepts at most 20 captured submissions", () => {
    const submission = {
      language: "TypeScript",
      code: "return [];",
      status: "Accepted" as const,
    };
    expect(
      captureProblemSchema.safeParse({
        ...baseCapture,
        submissions: Array.from({ length: 20 }, () => submission),
      }).success,
    ).toBe(true);
    expect(
      captureProblemSchema.safeParse({
        ...baseCapture,
        submissions: Array.from({ length: 21 }, () => submission),
      }).success,
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  agentNavigationSchema,
  agentProposalSchema,
  agentTurnRequestSchema,
  aiJobCreateRequestSchema,
  captureProblemSchema,
  cardDraftSchema,
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

  it("keeps executable AI job preconditions inside proposals", () => {
    expect(
      agentProposalSchema.safeParse({
        action: "quiz_next_batch",
        requestId: "14c3fc2b-d67c-49d2-bb7b-28d4210092c4",
        problemId: "problem-1",
        expectedQuizSessionId: "quiz-1",
        reason: "Create a new batch after the completed quiz.",
      }).success,
    ).toBe(true);
    expect(
      agentProposalSchema.safeParse({
        action: "quiz_next_batch",
        requestId: "14c3fc2b-d67c-49d2-bb7b-28d4210092c4",
        problemId: "problem-1",
        reason: "Missing the session precondition.",
      }).success,
    ).toBe(false);
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
});

describe("aiJobCreateRequestSchema", () => {
  it("accepts versioned async commands and rejects the retired synchronous shape", () => {
    expect(aiJobCreateRequestSchema.safeParse({
      action: "card_followup",
      problemId: "problem-1",
      requestId: "14c3fc2b-d67c-49d2-bb7b-28d4210092c4",
      cardId: "card-1",
      expectedCardVersion: 2,
      draft: { question: "Q", answer: "A" },
      instruction: "Make it shorter",
    }).success).toBe(true);
    expect(aiJobCreateRequestSchema.safeParse({
      mode: "single",
      action: "generate",
    }).success).toBe(false);
    expect(aiJobCreateRequestSchema.safeParse({
      action: "quiz_generate",
      problemId: "problem-1",
      requestId: "14c3fc2b-d67c-49d2-bb7b-28d4210092c4",
      expectedQuizSessionId: null,
    }).success).toBe(true);
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

  it("keeps card drafts compact enough for review responses", () => {
    expect(
      cardDraftSchema.safeParse({
        question: "q".repeat(5_000),
        answer: "a".repeat(20_000),
      }).success,
    ).toBe(true);
    expect(
      cardDraftSchema.safeParse({
        question: "q".repeat(5_001),
        answer: "answer",
      }).success,
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  agentNavigationSchema,
  agentProposalSchema,
  agentSessionPatchSchema,
  agentTurnRequestSchema,
  aiJobCreateRequestSchema,
  captureProblemSchema,
  cardDraftSchema,
  mistakeCreateSchema,
  mistakeListQuerySchema,
  mistakePatchSchema,
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

  it("accepts a compact session title and rejects empty or oversized titles", () => {
    expect(agentSessionPatchSchema.safeParse({ title: "  Greedy review  " }).data).toEqual({
      title: "Greedy review",
    });
    expect(agentSessionPatchSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(agentSessionPatchSchema.safeParse({ title: "x".repeat(81) }).success).toBe(false);
    expect(agentSessionPatchSchema.safeParse({ title: "Review", status: "archived" }).success).toBe(false);
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

  it("fills collection defaults for older metadata-only capture clients", () => {
    expect(captureProblemSchema.parse(baseCapture)).toEqual({
      ...baseCapture, topicTags: [], similarSlugs: [], submissions: [],
    });
  });

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

describe("Mistake contracts", () => {
  const base = {
    sourceType: "manual",
    requestId: "14c3fc2b-d67c-49d2-bb7b-28d4210092c4",
    problemId: "problem-1",
    primaryCategory: "invariant",
  };

  it("requires the reference that matches the source type", () => {
    expect(mistakeCreateSchema.safeParse(base).success).toBe(true);
    expect(mistakeCreateSchema.safeParse({ ...base, sourceType: "submission" }).success).toBe(false);
    expect(
      mistakeCreateSchema.safeParse({ ...base, sourceType: "submission", submissionId: "s1" }).success,
    ).toBe(true);
    expect(
      mistakeCreateSchema.safeParse({ ...base, sourceType: "quiz_answer", quizSessionId: "q1" }).success,
    ).toBe(false);
    // A manual record can't smuggle in a source reference.
    expect(mistakeCreateSchema.safeParse({ ...base, submissionId: "s1" }).success).toBe(false);
    expect(
      mistakeCreateSchema.safeParse({ ...base, sourceType: "review", reviewRequestId: "not-a-uuid" }).success,
    ).toBe(false);
  });

  it("rejects unknown categories, including quiz-only scopes", () => {
    expect(mistakeCreateSchema.safeParse({ ...base, primaryCategory: "mistake_review" }).success).toBe(false);
    expect(mistakeCreateSchema.safeParse({ ...base, primaryCategory: "algorithm_selection" }).success).toBe(false);
  });

  it("bounds free text and tags", () => {
    expect(mistakeCreateSchema.safeParse({ ...base, summary: "s".repeat(2_000) }).success).toBe(true);
    expect(mistakeCreateSchema.safeParse({ ...base, summary: "s".repeat(2_001) }).success).toBe(false);
    expect(mistakeCreateSchema.safeParse({ ...base, nextStep: "n".repeat(1_001) }).success).toBe(false);
    expect(mistakeCreateSchema.safeParse({ ...base, secondaryTags: Array(9).fill("tag") }).success).toBe(false);
    expect(mistakeCreateSchema.safeParse({ ...base, secondaryTags: ["t".repeat(33)] }).success).toBe(false);
  });

  it("rejects empty or unknown patches and AI-only status values", () => {
    expect(mistakePatchSchema.safeParse({}).success).toBe(false);
    expect(mistakePatchSchema.safeParse({ resolved: true }).success).toBe(true);
    expect(mistakePatchSchema.safeParse({ summary: null }).success).toBe(true);
    expect(mistakePatchSchema.safeParse({ status: "candidate" }).success).toBe(false);
    expect(mistakePatchSchema.safeParse({ userId: "user-2" }).success).toBe(false);
  });

  it("parses list queries from a query string with defaults and bounds", () => {
    expect(mistakeListQuerySchema.parse({})).toEqual({ status: "confirmed", limit: 20 });
    expect(mistakeListQuerySchema.parse({ limit: "50", category: "edge_case" })).toMatchObject({ limit: 50 });
    expect(mistakeListQuerySchema.safeParse({ limit: "51" }).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { captureProblemSchema, cardDraftSchema, reviewRatingSchema } from "./schemas";

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

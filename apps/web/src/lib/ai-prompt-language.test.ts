import { describe, expect, it } from "vitest";
import { buildAiCardDraftPrompt } from "./card-prompt";
import { buildQuizPrompt } from "./quiz-prompt";

const problem = {
  title: "Two Sum",
  difficulty: "Easy" as const,
  topicTags: ["Array", "Hash Table"],
  descriptionMd: "Return the indices of two numbers that add up to the target.",
  url: "https://leetcode.com/problems/two-sum/",
  leetcodeSlug: "two-sum",
  notes: "Remember why one pass is enough.",
};

const submissions = [
  {
    language: "typescript",
    code: "const seen = new Map<number, number>();",
    status: "Accepted" as const,
    errorMessage: null,
    failedTestcase: null,
    expectedOutput: null,
    actualOutput: null,
    submittedAt: new Date("2026-07-01T00:00:00.000Z"),
  },
];

describe("AI prompt generation language", () => {
  it("defaults new cards and quizzes to English", () => {
    const card = buildAiCardDraftPrompt({
      problem,
      submissions,
      action: "generate",
    });
    const quiz = buildQuizPrompt({
      problem,
      submissions,
      cards: [],
    });

    expect(card.system).toContain("Write all user-facing card content in English.");
    expect(card.user).toContain("Output language: English.");
    expect(quiz.system).toContain(
      "All user-facing item fields (question, choices, explanation) must be written in English.",
    );
    expect(quiz.user).toContain("Generate the quiz now in English.");
  });

  it("switches both prompts to Simplified Chinese when configured", () => {
    const card = buildAiCardDraftPrompt({
      problem,
      submissions,
      action: "generate",
      generationLanguage: "zh",
    });
    const quiz = buildQuizPrompt({
      problem,
      submissions,
      cards: [],
      generationLanguage: "zh",
    });

    expect(card.system).toContain(
      "Write all user-facing card content in Simplified Chinese.",
    );
    expect(card.user).toContain("Output language: Simplified Chinese.");
    expect(quiz.system).toContain(
      "All user-facing item fields (question, choices, explanation) must be written in Simplified Chinese.",
    );
    expect(quiz.user).toContain("Generate the quiz now in Simplified Chinese.");
  });
});

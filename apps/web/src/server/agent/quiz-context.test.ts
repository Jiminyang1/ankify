import { describe, expect, it } from "vitest";
import type { QuizSession } from "@ankify/db";
import { toAgentSafeQuizState } from "./quiz-context";

const item = {
  id: "q1",
  question: "Which invariant holds?",
  choices: ["A", "B", "C", "D"],
  answerIndex: 2,
  explanation: "C preserves the invariant.",
  source: "submission" as const,
  scope: "invariant" as const,
};

function session(answersJson: QuizSession["answersJson"]): QuizSession {
  return {
    id: "quiz-1",
    userId: "user-1",
    problemId: "problem-1",
    status: "active",
    itemsJson: [item],
    answersJson,
    score: null,
    createdAt: new Date(),
    updatedAt: null,
    completedAt: null,
  };
}

describe("toAgentSafeQuizState", () => {
  it("withholds every answer-bearing field for unanswered items", () => {
    const state = toAgentSafeQuizState(session([]));
    expect(state.items[0]).toEqual({
      id: "q1",
      answered: false,
      source: "submission",
      scope: "invariant",
    });
    expect(state.items[0]).not.toHaveProperty("question");
    expect(state.items[0]).not.toHaveProperty("choices");
    expect(state.items[0]).not.toHaveProperty("answerIndex");
    expect(state.items[0]).not.toHaveProperty("explanation");
  });

  it("exposes feedback only after the item is answered", () => {
    const state = toAgentSafeQuizState(
      session([
        {
          itemId: "q1",
          selectedIndex: 1,
          correct: false,
          answeredAt: new Date().toISOString(),
        },
      ]),
    );
    expect(state.items[0]).toMatchObject({
      answered: true,
      question: item.question,
      choices: item.choices,
      selectedIndex: 1,
      answerIndex: 2,
      explanation: item.explanation,
    });
  });
});

import type { QuizSession } from "@ankify/db";

export function toAgentSafeQuizState(session: QuizSession) {
  const answers = new Map(session.answersJson.map((answer) => [answer.itemId, answer]));
  return {
    id: session.id,
    status: session.status,
    score: session.score,
    answeredCount: session.answersJson.length,
    items: session.itemsJson.map((item) => {
      const answer = answers.get(item.id);
      if (!answer) {
        return {
          id: item.id,
          answered: false as const,
          source: item.source,
          scope: item.scope,
        };
      }
      return {
        id: item.id,
        answered: true as const,
        question: item.question,
        choices: item.choices,
        selectedIndex: answer.selectedIndex,
        correct: answer.correct,
        answerIndex: item.answerIndex,
        explanation: item.explanation,
        source: item.source,
        scope: item.scope,
      };
    }),
  };
}

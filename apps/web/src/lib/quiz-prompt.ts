import type { Card, Problem, Submission } from "@ankify/db";
import type { QuizAnswer, QuizItem } from "@ankify/core";

const TEXT_MAX = 7000;
const NOTE_MAX = 1600;
const CODE_MAX = 1000;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n... (truncated)";
}

function fmtTime(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return "time unknown";
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export function buildQuizPrompt(args: {
  problem: Pick<Problem, "title" | "difficulty" | "topicTags" | "descriptionMd" | "url" | "leetcodeSlug" | "notes">;
  cards: Pick<Card, "question" | "answer">[];
  submissions: Pick<
    Submission,
    | "language"
    | "code"
    | "status"
    | "errorMessage"
    | "failedTestcase"
    | "expectedOutput"
    | "actualOutput"
    | "submittedAt"
  >[];
  history?: {
    id: string;
    score: number | null;
    itemsJson: QuizItem[];
    answersJson: QuizAnswer[];
  }[];
}): { system: string; user: string } {
  const { problem, cards, submissions, history = [] } = args;

  const problemLines = [
    "## Problem",
    `- Title: ${problem.title}`,
    `- Difficulty: ${problem.difficulty}`,
    `- Slug: \`${problem.leetcodeSlug}\``,
    `- URL: ${problem.url}`,
    problem.topicTags.length > 0 ? `- Tags: ${problem.topicTags.join(", ")}` : null,
    problem.notes?.trim() ? `\n### User notes\n${truncate(problem.notes.trim(), NOTE_MAX)}` : null,
    problem.descriptionMd?.trim()
      ? `\n### Statement markdown\n${truncate(problem.descriptionMd.trim(), TEXT_MAX)}`
      : "\n### Statement markdown\n(no statement captured)",
  ].filter(Boolean);

  const cardLines = ["## Saved ready cards"];
  if (cards.length === 0) {
    cardLines.push("(none)");
  } else {
    cards.slice(0, 12).forEach((card, i) => {
      cardLines.push(`### Card ${i + 1}`);
      cardLines.push(`Q: ${truncate(card.question, 700)}`);
      cardLines.push(`A: ${truncate(card.answer, 900)}`);
    });
  }

  const acceptedN = submissions.filter((s) => s.status === "Accepted").length;
  const submissionLines = [
    "## Recent submissions",
    `Total shown: ${submissions.length}; accepted: ${acceptedN}; failed: ${submissions.length - acceptedN}.`,
  ];
  submissions.slice(0, 10).forEach((s, i) => {
    submissionLines.push(`### Submission ${i + 1}: ${s.status} · ${fmtTime(s.submittedAt)} · ${s.language}`);
    if (s.status !== "Accepted") {
      if (s.errorMessage) submissionLines.push(`Error: ${truncate(s.errorMessage, 800)}`);
      if (s.failedTestcase) submissionLines.push(`Failed testcase:\n\`\`\`\n${truncate(s.failedTestcase, 600)}\n\`\`\``);
      if (s.expectedOutput) submissionLines.push(`Expected:\n\`\`\`\n${truncate(s.expectedOutput, 300)}\n\`\`\``);
      if (s.actualOutput) submissionLines.push(`Actual:\n\`\`\`\n${truncate(s.actualOutput, 300)}\n\`\`\``);
    }
    submissionLines.push("```" + s.language);
    submissionLines.push(truncate(s.code, CODE_MAX));
    submissionLines.push("```");
  });

  const historyLines = [
    "## Recent completed quiz history",
    "Use this only to avoid repeats and balance missing scopes. Do not copy previous questions.",
  ];
  if (history.length === 0) {
    historyLines.push("(none)");
  } else {
    history.slice(0, 3).forEach((session, sessionIndex) => {
      historyLines.push(`### Completed batch ${sessionIndex + 1}; score ${session.score ?? "unknown"} / ${session.itemsJson.length}`);
      session.itemsJson.forEach((item, itemIndex) => {
        const answer = session.answersJson.find((a) => a.itemId === item.id);
        const correctChoice = item.choices[item.answerIndex] ?? "";
        const selectedChoice = answer ? item.choices[answer.selectedIndex] ?? "(missing choice)" : "(not answered)";
        historyLines.push(`- Q${itemIndex + 1}: ${truncate(item.question, 260)}`);
        historyLines.push(`  scope: ${item.scope}; source: ${item.source}; correct: ${answer?.correct ?? "unknown"}`);
        historyLines.push(`  correct answer: ${truncate(correctChoice, 180)}`);
        historyLines.push(`  user answer: ${truncate(selectedChoice, 180)}`);
      });
    });
  }

  const system = `You create focused LeetCode review quizzes for spaced repetition.

Return exactly 5 multiple-choice quiz items.

Rules:
- Each item must have exactly 4 choices and exactly one correct answer.
- All user-facing item fields (question, choices, explanation) must be written in Simplified Chinese.
- Keep code identifiers, variable names, API names, complexity notation, and short English terms unchanged when that is clearer.
- Use GitHub Flavored Markdown in question, choices, and explanation when useful.
- Wrap formulas, complexity expressions, DP states, and code-like variables in inline code, for example: \`O(amount * len(coins))\`, \`dp[i]\`, \`memo[rem]\`, \`amount + 1\`.
- Do not leave Big-O expressions or recurrence/state notation as plain prose.
- Do not use H1/H2/H3 headings inside any item field.
- Prioritize reasoning, state definitions, invariants, edge cases, complexity, and the user's past submission mistakes.
- Do not ask trivia about the problem statement wording.
- Keep explanations short and useful for immediate review feedback.
- Keep overall difficulty balanced: do not progressively increase difficulty just because recent scores were high.
- Avoid repeating or near-duplicating questions, choices, or explanations from recent completed quiz history.
- Use recent missed scopes to fill coverage gaps, while still keeping the batch balanced.
- Choose source from: statement, submission, notes, card.
- Choose scope from: approach, invariant, edge_case, complexity, implementation, mistake_review.
- The 5 items must cover at least 4 different scopes.
- Include at least 1 item with scope complexity. Complexity questions should test what the time/space complexity is and where it comes from.`;

  const user = [
    problemLines.join("\n"),
    cardLines.join("\n"),
    submissionLines.join("\n"),
    historyLines.join("\n"),
    "Generate the quiz now in Simplified Chinese. Use ids q1, q2, q3, q4, q5.",
  ].join("\n\n");

  return { system, user };
}

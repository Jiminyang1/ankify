import type { Card, Problem, Submission } from "@ankify/db";

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
}): { system: string; user: string } {
  const { problem, cards, submissions } = args;

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

  const system = `You create focused LeetCode review quizzes for spaced repetition.

Return exactly 5 multiple-choice quiz items.

Rules:
- Each item must have exactly 4 choices and exactly one correct answer.
- All user-facing item fields (question, choices, explanation) must be written in Simplified Chinese.
- Keep code identifiers, variable names, API names, complexity notation, and short English terms unchanged when that is clearer.
- Use GitHub Flavored Markdown in question, choices, and explanation when useful.
- Do not use H1/H2/H3 headings inside any item field.
- Prioritize reasoning, state definitions, invariants, edge cases, complexity, and the user's past submission mistakes.
- Do not ask trivia about the problem statement wording.
- Keep explanations short and useful for immediate review feedback.
- Choose source from: statement, submission, notes, card.`;

  const user = [
    problemLines.join("\n"),
    cardLines.join("\n"),
    submissionLines.join("\n"),
    "Generate the quiz now in Simplified Chinese. Use ids q1, q2, q3, q4, q5.",
  ].join("\n\n");

  return { system, user };
}

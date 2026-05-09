import type { Card, Problem, Submission } from "@ankify/db";
import type { QuizAnswer, QuizItem } from "@ankify/core";

const TEXT_MAX = 3000;   // problem statement (most LeetCode statements fit; long ones get truncated)
const NOTE_MAX = 1600;   // user notes — kept generous since they're high-signal
const CODE_MAX = 500;    // per-submission code (key algorithm logic almost always fits)
const MAX_CARDS = 6;
const MAX_SUBMISSIONS = 5;
const MAX_HISTORY = 2;

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

  // Section 1: problem metadata + the official statement.
  const problemLines = [
    "## Problem",
    `- Title: ${problem.title}`,
    `- Difficulty: ${problem.difficulty}`,
    `- Slug: \`${problem.leetcodeSlug}\``,
    `- URL: ${problem.url}`,
    problem.topicTags.length > 0 ? `- Tags: ${problem.topicTags.join(", ")}` : null,
    problem.descriptionMd?.trim()
      ? `\n### Statement markdown\n${truncate(problem.descriptionMd.trim(), TEXT_MAX)}`
      : "\n### Statement markdown\n(no statement captured)",
  ].filter(Boolean);

  // Section 2: user notes — promoted to a top-level section because they're
  // the user's own synthesis (lessons, gotchas, alternative approaches) and
  // typically the highest-signal context for a personalized review quiz.
  // Skipped entirely when there are no notes.
  const notesLines = problem.notes?.trim()
    ? ["## User notes", truncate(problem.notes.trim(), NOTE_MAX)]
    : null;

  // Section 3: ready cards — the user's curated knowledge for this problem.
  const cardLines = ["## Saved ready cards"];
  if (cards.length === 0) {
    cardLines.push("(none)");
  } else {
    cards.slice(0, MAX_CARDS).forEach((card, i) => {
      cardLines.push(`### Card ${i + 1}`);
      cardLines.push(`Q: ${truncate(card.question, 500)}`);
      cardLines.push(`A: ${truncate(card.answer, 700)}`);
    });
  }

  // Section 4: submissions — actual code the user has written. Failed ones
  // carry the most signal (mistakes → mistake_review / edge_case items).
  const acceptedN = submissions.filter((s) => s.status === "Accepted").length;
  const submissionLines = [
    "## Recent submissions",
    `Total shown: ${submissions.length}; accepted: ${acceptedN}; failed: ${submissions.length - acceptedN}.`,
  ];
  submissions.slice(0, MAX_SUBMISSIONS).forEach((s, i) => {
    submissionLines.push(`### Submission ${i + 1}: ${s.status} · ${fmtTime(s.submittedAt)} · ${s.language}`);
    if (s.status !== "Accepted") {
      if (s.errorMessage) submissionLines.push(`Error: ${truncate(s.errorMessage, 600)}`);
      if (s.failedTestcase) submissionLines.push(`Failed testcase:\n\`\`\`\n${truncate(s.failedTestcase, 400)}\n\`\`\``);
      if (s.expectedOutput) submissionLines.push(`Expected:\n\`\`\`\n${truncate(s.expectedOutput, 200)}\n\`\`\``);
      if (s.actualOutput) submissionLines.push(`Actual:\n\`\`\`\n${truncate(s.actualOutput, 200)}\n\`\`\``);
    }
    submissionLines.push("```" + s.language);
    submissionLines.push(truncate(s.code, CODE_MAX));
    submissionLines.push("```");
  });

  // Section 5: recent quiz history — used solely to avoid repeats and pick
  // missed scopes. Wiped when the user clicks Reset.
  const historyLines = [
    "## Recent completed quiz history",
    "Use this only to avoid repeats and balance missing scopes. Do not copy previous questions.",
  ];
  if (history.length === 0) {
    historyLines.push("(none)");
  } else {
    history.slice(0, MAX_HISTORY).forEach((session, sessionIndex) => {
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

For each item, fill the fields in this exact order:
1. \`question\` — the prompt shown to the user.
2. \`choices\` — exactly 4 options. The correct one must be among them; the other three must be plausible distractors a learner could realistically pick, not absurd.
3. \`correctAnswer\` — the exact text of the correct option, character-for-character identical to the matching entry in \`choices\` (whitespace, punctuation, casing, code formatting all the same). The server matches by string equality.
4. \`explanation\` — a concise rationale shown to the user after they answer.
5. \`source\` and \`scope\`.

Self-check before finishing each item:
- Does \`correctAnswer\` literally appear in \`choices\`? If not, fix it.
- Does \`explanation\` justify exactly the choice in \`correctAnswer\`? If not, either change the answer or rewrite the explanation.

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

\`source\` and \`scope\` are TWO DIFFERENT enums. Do not confuse them:
- \`source\` answers "where did the question come from?" — pick exactly one of: \`statement\`, \`submission\`, \`notes\`, \`card\`. Never put a scope value here.
- \`scope\` answers "what kind of question is it?" — pick exactly one of: \`approach\`, \`invariant\`, \`edge_case\`, \`complexity\`, \`implementation\`, \`mistake_review\`. Never put a source value here.

Examples (just for the source/scope distinction):
- A question about a failed test case from a Wrong Answer submission: source=\`submission\`, scope=\`edge_case\` or \`mistake_review\`.
- A question about the high-level greedy strategy from the statement: source=\`statement\`, scope=\`approach\`.
- A complexity question grounded in the user's notes: source=\`notes\`, scope=\`complexity\`.

- The 5 items must cover at least 4 different \`scope\` values.
- Include at least 1 item with \`scope\` = \`complexity\`. Complexity questions should test what the time/space complexity is and where it comes from.`;

  const user = [
    problemLines.join("\n"),
    notesLines ? notesLines.join("\n") : null,
    cardLines.join("\n"),
    submissionLines.join("\n"),
    historyLines.join("\n"),
    "Generate the quiz now in Simplified Chinese.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { system, user };
}

import { generateText, Output } from "ai";
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import {
  leetcodeTagName,
  notesSections,
  parseCards,
  validateCheckItems,
  type CheckViolation,
} from "@ankify/core";
import { practiceCheckDraftSchema, type PracticeCheckItem } from "@ankify/contracts";
import { getDb, schema } from "@ankify/db";
import { getActiveModel } from "@/server/ai";
import { aiCallOptions } from "@/server/ai/call-options";
import { getGenerationSettings } from "@/server/settings";

/**
 * Check questions for a practice session (docs/coach-practice.md). The model
 * writes three multiple-choice questions grounded in the problem's statement,
 * docs, and submissions; validateCheckItems() enforces the rules. One
 * immediate retry gets the violations as feedback, then the job gives up and
 * the session continues with cards only.
 */

const TIMEOUT_MS = 150_000;
const STATEMENT_MAX = 3_000;
const DOC_MAX = 3_000;
const CODE_MAX = 600;
const MAX_SUBMISSIONS = 6;
/** A failed submission this recent must get a mistake_review question. */
const MISTAKE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export class PracticeCheckInvalidError extends Error {
  constructor(readonly violations: CheckViolation[]) {
    super("practice_check_invalid");
  }
}

export function clip(text: string | null | undefined, max: number) {
  const value = (text ?? "").trim();
  return value.length <= max ? value : `${value.slice(0, max)}\n... (truncated)`;
}

export function plainText(html: string | null | undefined) {
  return (html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function generatePracticeCheck(args: {
  userId: string;
  problemId: string;
  practiceSessionId: string;
}): Promise<PracticeCheckItem[]> {
  const db = getDb();
  const [problem] = await db
    .select()
    .from(schema.problems)
    .where(and(eq(schema.problems.id, args.problemId), eq(schema.problems.userId, args.userId)))
    .limit(1);
  if (!problem) throw new Error("problem_not_found");
  const [session] = await db
    .select()
    .from(schema.practiceSessions)
    .where(
      and(eq(schema.practiceSessions.id, args.practiceSessionId), eq(schema.practiceSessions.userId, args.userId)),
    )
    .limit(1);
  if (!session) throw new Error("practice_session_not_found");

  const [submissions, recentPractice, recentQuiz, { model, settings }, generation] = await Promise.all([
    db
      .select()
      .from(schema.submissions)
      .where(and(eq(schema.submissions.userId, args.userId), eq(schema.submissions.problemId, args.problemId)))
      .orderBy(desc(schema.submissions.submittedAt))
      .limit(MAX_SUBMISSIONS),
    db
      .select({ checkJson: schema.practiceSessions.checkJson })
      .from(schema.practiceSessions)
      .where(
        and(
          eq(schema.practiceSessions.userId, args.userId),
          eq(schema.practiceSessions.problemId, args.problemId),
          ne(schema.practiceSessions.id, session.id),
          isNotNull(schema.practiceSessions.checkJson),
        ),
      )
      .orderBy(desc(schema.practiceSessions.createdAt))
      .limit(3),
    db
      .select({ itemsJson: schema.quizSessions.itemsJson })
      .from(schema.quizSessions)
      .where(and(eq(schema.quizSessions.userId, args.userId), eq(schema.quizSessions.problemId, args.problemId)))
      .orderBy(desc(schema.quizSessions.createdAt))
      .limit(2),
    getActiveModel(args.userId),
    getGenerationSettings(args.userId),
  ]);

  const cards = parseCards(problem.cardsMd).cards;
  const sections = notesSections(problem.notes);
  const recentQuestions = [
    ...recentPractice.flatMap((row) => (row.checkJson ?? []).map((item) => item.question)),
    ...recentQuiz.flatMap((row) => row.itemsJson.map((item) => item.question)),
  ];
  const since = Date.now() - MISTAKE_WINDOW_MS;
  const requireMistakeReview = submissions.some(
    (submission) => submission.status !== "Accepted" && (submission.submittedAt?.getTime() ?? 0) >= since,
  );
  const rules = {
    notesSections: sections,
    notesWithoutSections: sections.length === 0 && Boolean(problem.notes?.trim()),
    cardKeys: cards.map((card) => card.key),
    submissionIds: submissions.map((submission) => submission.id),
    selectedCardPrompts: session.recallJson.map((card) => card.prompt),
    recentQuestions,
    requireMistakeReview,
  };

  const language = generation.language === "zh" ? "Simplified Chinese" : "English";
  const context = [
    `# Problem: ${problem.title} (${problem.difficulty})`,
    `Topics: ${problem.topicTags.map(leetcodeTagName).join(", ") || "none"}`,
    "",
    "## Statement (sourceKind: statement, sourceRef: empty)",
    clip(plainText(problem.descriptionMd), STATEMENT_MAX) || "(not captured)",
    "",
    sections.length
      ? "## Notes doc (sourceKind: notes, sourceRef: one of the section headings listed)"
      : "## Notes doc (sourceKind: notes, sourceRef: empty, since it has no sections)",
    sections.length ? `Sections: ${sections.join(" | ")}` : "",
    clip(problem.notes, DOC_MAX) || "(empty)",
    "",
    "## Cards doc (sourceKind: card, sourceRef: the key in brackets)",
    cards.length ? cards.map((card) => `- [${card.key}] ${card.prompt}\n  ${card.answer.replace(/\n/g, "\n  ")}`).join("\n") : "(empty)",
    "",
    "## Cards the user is recalling in this session (do not ask these again)",
    session.recallJson.length ? session.recallJson.map((card) => `- ${card.prompt}`).join("\n") : "(none)",
    "",
    "## Submissions, newest first (sourceKind: submission, sourceRef: the id in brackets)",
    submissions.length
      ? submissions
          .map((submission, index) =>
            [
              `### [${submission.id}] attempt ${submissions.length - index}: ${submission.status} (${submission.language})`,
              submission.failedTestcase ? `Failed input: ${clip(submission.failedTestcase, 300)}` : null,
              submission.expectedOutput ? `Expected: ${clip(submission.expectedOutput, 200)}` : null,
              submission.actualOutput ? `Got: ${clip(submission.actualOutput, 200)}` : null,
              submission.errorMessage ? `Error: ${clip(submission.errorMessage, 300)}` : null,
              "```",
              clip(submission.code, CODE_MAX),
              "```",
            ]
              .filter(Boolean)
              .join("\n"),
          )
          .join("\n\n")
      : "(none)",
    "",
    "## Recent questions (never repeat or rephrase these)",
    recentQuestions.length ? recentQuestions.map((question) => `- ${question}`).join("\n") : "(none)",
  ].join("\n");

  const instructions = `You write exactly 3 multiple-choice check questions for a spaced-repetition review of one LeetCode problem. They find gaps the user's own cards don't cover.

Return one JSON object of this shape and nothing else:
{"items": [{"question": "...", "choices": ["...", "...", "...", "..."], "correctAnswer": "...", "explanation": "...", "scope": "...", "sourceKind": "...", "sourceRef": "..."}]}

Fields, in this order:
1. question: what the user is asked.
2. choices: exactly 4 plausible options, one correct.
3. correctAnswer: the correct option, character-for-character identical to its entry in choices.
4. explanation: 1 to 3 sentences on why that answer is right.
5. scope: one of approach, invariant, edge_case, complexity, implementation, mistake_review.
6. sourceKind and sourceRef: where the question comes from. statement (sourceRef ""), notes (sourceRef = an exact section heading, or "" when the Notes doc has no sections), card (sourceRef = a card key), or submission (sourceRef = a submission id).

Rules:
- Ground every question in the material provided and cite it with sourceKind and sourceRef.
- Use 3 different scopes. Cover complexity unless a recalled card already asks about time or space cost.${requireMistakeReview ? "\n- At least one question has scope mistake_review and cites a failed submission: what went wrong in that attempt and why." : ""}
- Don't restate the recalled cards or any recent question.
- Write question, choices, and explanation in ${language}. Keep code identifiers and complexity notation unchanged, and wrap them in inline code, for example \`dp[i]\` or \`O(n log n)\`. No headings inside fields.`;

  const attempt = async (feedback: string | null) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const { output } = await generateText({
        model,
        output: Output.object({ schema: practiceCheckDraftSchema }),
        system: instructions,
        prompt: `${context}\n\n${feedback ? `## Your previous batch broke these rules; fix them\n${feedback}\n\n` : ""}Write the 3 questions now and return only the JSON object.`,
        ...aiCallOptions(settings, "user"),
        abortSignal: controller.signal,
      });
      return output.items;
    } finally {
      clearTimeout(timer);
    }
  };

  let draft = await attempt(null);
  let violations = validateCheckItems(draft, rules);
  if (violations.length > 0) {
    draft = await attempt(violations.map(describeViolation).join("\n"));
    violations = validateCheckItems(draft, rules);
  }
  if (violations.length > 0) {
    console.warn("[practice-check] invalid after retry", { problemId: args.problemId, violations });
    throw new PracticeCheckInvalidError(violations);
  }

  return draft.map((item, index) => {
    const choices = item.choices.map((choice) => choice.trim());
    return {
      id: `c${index + 1}`,
      question: item.question.trim(),
      choices,
      answerIndex: choices.indexOf(item.correctAnswer.trim()),
      explanation: item.explanation.trim(),
      scope: item.scope,
      source: { kind: item.sourceKind, ref: item.sourceKind === "statement" ? null : item.sourceRef.trim() },
    };
  });
}

function describeViolation(violation: CheckViolation): string {
  switch (violation.rule) {
    case "count":
      return `- Write exactly ${violation.expected} questions.`;
    case "correct_answer_not_a_choice":
      return `- Question ${violation.item + 1}: correctAnswer must equal one of the choices exactly.`;
    case "duplicate_choices":
      return `- Question ${violation.item + 1}: the four choices must differ.`;
    case "citation":
      return `- Question ${violation.item + 1}: sourceRef doesn't exist; cite a real section heading, card key, or submission id.`;
    case "scopes":
      return `- Use at least ${violation.minimum} different scopes.`;
    case "complexity":
      return "- Include a complexity question.";
    case "mistake_review":
      return "- Include a mistake_review question citing a failed submission.";
    case "restates_card":
      return `- Question ${violation.item + 1} restates a card the user is recalling; ask something else.`;
    case "repeats_recent":
      return `- Question ${violation.item + 1} repeats a recent question; ask something new.`;
    case "repeats_in_batch":
      return `- Question ${violation.item + 1} repeats another question in this batch.`;
  }
}


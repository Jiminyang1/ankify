import type { Problem, Submission } from "@ankify/db";
import type { CardDraft } from "@ankify/core";
import type { Language } from "./i18n";

const RAW_TEXT_MAX = 6000;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n… (truncated)";
}

function fmtTime(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return "time unknown";
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export function buildAiCardPromptContext(args: {
  problem: Pick<
    Problem,
    "title" | "difficulty" | "topicTags" | "descriptionMd" | "url" | "leetcodeSlug" | "notes"
  >;
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
  rawText: string;
}): Record<string, string> {
  const { problem, submissions, rawText } = args;

  const sectionALines: string[] = [];
  sectionALines.push("## A · Problem context (reference only)");
  sectionALines.push(`- **Title**: ${problem.title}`);
  sectionALines.push(`- **Difficulty**: ${problem.difficulty}`);
  sectionALines.push(`- **Slug**: \`${problem.leetcodeSlug}\``);
  sectionALines.push(`- **URL**: ${problem.url}`);
  if (problem.topicTags.length > 0) {
    sectionALines.push(`- **Tags**: ${problem.topicTags.join(", ")}`);
  }
  if (problem.notes?.trim()) {
    sectionALines.push("### User notes");
    sectionALines.push(truncate(problem.notes.trim(), 1500));
  }

  if (problem.descriptionMd?.trim()) {
    sectionALines.push("### Problem statement excerpt (Markdown, may be truncated)");
    sectionALines.push(truncate(problem.descriptionMd.trim(), 8000));
  } else {
    sectionALines.push("### Problem statement excerpt");
    sectionALines.push("_(No statement was captured. Infer intent from the title and tags.)_");
  }

  const SECTION_A = sectionALines.join("\n");

  const acceptedN = submissions.filter((s) => s.status === "Accepted").length;
  const failedN = submissions.length - acceptedN;

  const sectionBLines: string[] = [];
  sectionBLines.push("## B · Submission history (newest first)");
  sectionBLines.push(
    `Showing **${submissions.length}** records: **${acceptedN}** accepted and **${failedN}** not accepted. ` +
      "Use these only to resolve references in the user's raw text and understand their reasoning.",
  );

  const maxSubs = 10;
  const shown = submissions.slice(0, maxSubs);
  shown.forEach((s, i) => {
    const head = `[#${i + 1}] **${s.status}** · ${fmtTime(s.submittedAt)} · ${s.language}`;
    sectionBLines.push(head);
    if (s.status !== "Accepted") {
      const errBits = [s.errorMessage, s.failedTestcase && `(case) ${truncate(s.failedTestcase, 200)}`]
        .filter(Boolean)
        .join(" · ");
      if (errBits) sectionBLines.push(`  · ${truncate(errBits, 800)}`);
    }
    sectionBLines.push("```" + s.language);
    sectionBLines.push(truncate(s.code, 900));
    sectionBLines.push("```");
  });

  if (submissions.length > maxSubs) {
    sectionBLines.push(
      `_There are ${submissions.length - maxSubs} older submissions not shown. Treat the user's raw text as the primary source._`,
    );
  }

  const SECTION_B = sectionBLines.join("\n");

  const rt = truncate(rawText.trim(), RAW_TEXT_MAX);
  const SECTION_C = "## C · User's own words (the primary material to structure)\n\n" + rt;

  return { SECTION_A, SECTION_B, SECTION_C, RAW_TEXT: rt };
}

export function buildAiCardDraftPrompt(args: {
  problem: Parameters<typeof buildAiCardPromptContext>[0]["problem"];
  submissions: Parameters<typeof buildAiCardPromptContext>[0]["submissions"];
  action: "generate" | "followup";
  rawText?: string;
  draft?: Pick<CardDraft, "question" | "answer">;
  instruction?: string;
  generationLanguage?: Language;
}): { system: string; user: string } {
  const vars = buildAiCardPromptContext({
    problem: args.problem,
    submissions: args.submissions,
    rawText: args.rawText ?? "",
  });

  const generationLanguage = args.generationLanguage ?? "en";
  const outputLanguage =
    generationLanguage === "zh" ? "Simplified Chinese" : "English";

  const system = `You edit LeetCode spaced-repetition cards. Your output becomes an unconfirmed candidate card and does not enter the review queue until the user confirms it.

Core rules:
- Write all user-facing card content in ${outputLanguage}.
- Keep code identifiers, variable names, API names, and complexity notation unchanged when that is clearer.
- Only help generate or revise the candidate; never claim that it has been saved or confirmed.
- Do not invent a generic editorial solution. Use the problem and submissions only to understand the user's context.
- Return only the \`question\` (front) and \`answer\` (back) fields.
- Both fields may use GitHub Flavored Markdown.
- Use Markdown sparingly: the question is usually one active-recall prompt; the answer may use short lists, inline code, and a code block only when needed.
- Do not use H1/H2/H3 headings and do not turn the answer into a full-length solution.
- The question must test one specific, verifiable recall point.
- The answer must be direct and accurate enough for the user to check their understanding.`;

  const actionLine =
    args.action === "generate"
      ? args.rawText?.trim()
        ? "Task: Create one editable review-card draft from the user's raw idea in section C."
        : "Task: Create one editable review-card draft from the problem context and submission history."
      : "Task: Revise the current draft according to the user's follow-up instruction and return the complete revised draft.";

  const user = [
    vars.SECTION_A,
    vars.SECTION_B,
    args.rawText?.trim() ? vars.SECTION_C : null,
    "## Current draft",
    args.draft
      ? `Q: ${args.draft.question}\nA: ${args.draft.answer}`
      : args.rawText?.trim()
        ? "_Create it from the raw idea._"
        : "_No current draft. Create it from the problem context._",
    args.instruction?.trim() ? `## User follow-up instruction\n\n${args.instruction.trim()}` : null,
    actionLine,
    `Output language: ${outputLanguage}. Return only the structured fields and do not explain what you did.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { system, user };
}

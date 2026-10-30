import { generateText, Output, type LanguageModel } from "ai";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { WEAKNESS_CATEGORIES } from "@ankify/core";
import type { WeaknessDto } from "@ankify/contracts";
import { getDb, schema } from "@ankify/db";
import { aiCallOptions } from "@/server/ai/call-options";
import type { AiRuntimeSettings } from "@/server/settings";
import { listProblemWeaknesses, loadWeaknessProfile, recordWeakness } from "@/server/weaknesses";

/**
 * "Analyze my attempts" (docs/coach-practice.md, version 2). Recording weak
 * spots must not depend on the chat model choosing to call a tool, so the
 * server runs one structured call that returns findings as data, records each
 * through recordWeakness() (the same checks as the Coach tool), and hands the
 * results to the Coach to explain.
 */

const MAX_FINDINGS = 4;
const CODE_MAX = 1_200;
const MAX_SUBMISSIONS = 10;

const findingsSchema = z.object({
  findings: z
    .array(
      z.object({
        category: z.string().max(40),
        detail: z.string().min(1).max(300),
        submissionIds: z.array(z.string().max(64)).max(5),
      }),
    )
    .max(MAX_FINDINGS),
});

export type AnalysisFinding = { weakness: WeaknessDto; merged: boolean };

function clip(text: string | null | undefined, max: number) {
  const value = (text ?? "").trim();
  return value.length <= max ? value : `${value.slice(0, max)}\n... (truncated)`;
}

export async function analyzeAttempts(args: {
  userId: string;
  problemId: string;
  runId: string;
  model: LanguageModel;
  settings: AiRuntimeSettings;
  abortSignal?: AbortSignal;
}): Promise<AnalysisFinding[]> {
  const db = getDb();
  const [problem] = await db
    .select()
    .from(schema.problems)
    .where(and(eq(schema.problems.id, args.problemId), eq(schema.problems.userId, args.userId)))
    .limit(1);
  if (!problem) return [];
  const [submissions, existing, profile] = await Promise.all([
    db
      .select()
      .from(schema.submissions)
      .where(and(eq(schema.submissions.userId, args.userId), eq(schema.submissions.problemId, args.problemId)))
      .orderBy(desc(schema.submissions.submittedAt))
      .limit(MAX_SUBMISSIONS),
    listProblemWeaknesses(args.userId, args.problemId),
    loadWeaknessProfile(args.userId),
  ]);
  if (!submissions.some((submission) => submission.status !== "Accepted")) {
    // Nothing failed: there's no evidence of a mistake to record.
    return [];
  }

  const categories = [
    ...WEAKNESS_CATEGORIES.map((category) => `- ${category.key}: ${category.description}`),
    ...profile.customCategories.map((category) => `- ${category.key}: ${category.description}`),
  ].join("\n");
  const prompt = [
    `# Problem: ${problem.title} (${problem.difficulty})`,
    "",
    "## Notes",
    clip(problem.notes, 2_000) || "(empty)",
    "",
    "## Already recorded weak spots (don't repeat these)",
    existing.length ? existing.map((weakness) => `- [${weakness.category}] ${weakness.detail}`).join("\n") : "(none)",
    "",
    "## Submissions, newest first",
    submissions
      .map((submission) =>
        [
          `### [${submission.id}] ${submission.status} (${submission.language})`,
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
      .join("\n\n"),
    "",
    "Return the JSON object now.",
  ].join("\n");

  const { output } = await generateText({
    model: args.model,
    output: Output.object({ schema: findingsSchema }),
    system: `You diagnose a LeetCode learner's mistakes from their own failed submissions.

Return one JSON object of this shape and nothing else:
{"findings": [{"category": "...", "detail": "...", "submissionIds": ["..."]}]}

- One finding per distinct mistake that a failed submission actually shows; at most ${MAX_FINDINGS}. No findings when nothing failed for a reason you can see.
- category: the best-fitting key from this list:
${categories}
- detail: one concrete sentence about this problem, e.g. "dp starts at 0, so amount 0 returns the wrong count".
- submissionIds: the ids (in brackets) of the submissions that show it.
- Don't repeat an already recorded weak spot. Don't invent mistakes the evidence doesn't show.`,
    prompt,
    ...aiCallOptions(args.settings, "user"),
    abortSignal: args.abortSignal,
  });

  const recorded: AnalysisFinding[] = [];
  for (const finding of output.findings) {
    const result = await recordWeakness(args.userId, {
      problemId: args.problemId,
      category: finding.category.trim(),
      detail: finding.detail,
      evidence: finding.submissionIds.map((ref) => ({ kind: "submission" as const, ref })),
      runId: args.runId,
    });
    if (result.ok) recorded.push({ weakness: result.weakness, merged: result.merged });
  }
  return recorded;
}

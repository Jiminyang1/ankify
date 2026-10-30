import { generateText, NoObjectGeneratedError, Output, type LanguageModel } from "ai";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { isSignalPoint, leetcodeTagName, parseSolutions, serializeSolutions, type SolutionApproach } from "@ankify/core";
import { isMiscPattern, patternsForSlug } from "@ankify/core/patterns";
import { getDb, schema } from "@ankify/db";
import { clip, plainText } from "@/server/ai-generation/practice-check";
import { aiCallOptions } from "@/server/ai/call-options";
import { getGenerationSettings, type AiRuntimeSettings } from "@/server/settings";

/**
 * The Solutions doc (docs/coach-practice.md, version 3): what talk-through
 * practice is judged against. Written once, during the turn that asks a
 * problem's first practice question (so the user reads and types meanwhile),
 * from the user's Accepted code, their Notes, and the problem, and saved
 * directly because the judge needs it for the first answer. After that it's
 * the user's: they read and edit it behind the book icon.
 *
 * Each approach is named for its technique and starts with its signal (what
 * in the statement points to that technique), since the review's first
 * question is "which technique, and what tells you?" (docs/product-main-line.md).
 */

/** Per attempt. At "low" thinking a doc takes 15-35 s; "high" took over a minute. */
const TIMEOUT_MS = 75_000;
const STATEMENT_MAX = 2_500;
const CODE_MAX = 3_000;
const NOTES_MAX = 2_000;

// Lenient on purpose: an extra point or approach is trimmed below rather than
// failing the whole doc.
const solutionsSchema = z.object({
  approaches: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        mine: z.boolean(),
        signal: z.string().min(1).max(300),
        points: z.array(z.string().min(1).max(400)).min(1).max(10),
        complexity: z.string().min(1).max(200),
      }),
    )
    .min(1)
    .max(6),
});
const MAX_APPROACHES = 3;
const MAX_POINTS = 5;

/** The problem's Solutions doc, written first if it's empty. Returns no
 *  approaches when there's none and it couldn't be written; the user's own
 *  text is never overwritten, even when it doesn't parse. */
export async function ensureSolutionsDoc(args: {
  userId: string;
  problemId: string;
  model: LanguageModel;
  settings: AiRuntimeSettings;
  abortSignal?: AbortSignal;
}): Promise<SolutionApproach[]> {
  const db = getDb();
  const [problem] = await db
    .select({
      title: schema.problems.title,
      slug: schema.problems.leetcodeSlug,
      difficulty: schema.problems.difficulty,
      descriptionMd: schema.problems.descriptionMd,
      topicTags: schema.problems.topicTags,
      notes: schema.problems.notes,
      solutionsMd: schema.problems.solutionsMd,
      solutionsVersion: schema.problems.solutionsVersion,
    })
    .from(schema.problems)
    .where(and(eq(schema.problems.id, args.problemId), eq(schema.problems.userId, args.userId)))
    .limit(1);
  if (!problem) return [];
  if (problem.solutionsMd?.trim()) return parseSolutions(problem.solutionsMd).approaches;

  const [accepted, generation] = await Promise.all([
    db
      .select({ code: schema.submissions.code, language: schema.submissions.language })
      .from(schema.submissions)
      .where(
        and(
          eq(schema.submissions.userId, args.userId),
          eq(schema.submissions.problemId, args.problemId),
          eq(schema.submissions.status, "Accepted"),
        ),
      )
      .orderBy(desc(schema.submissions.submittedAt))
      .limit(2),
    getGenerationSettings(args.userId),
  ]);
  const language = generation.language === "zh" ? "zh" : "en";
  const approaches = await generateSolutions({
    model: args.model,
    settings: args.settings,
    abortSignal: args.abortSignal,
    language,
    problem: {
      title: problem.title,
      difficulty: problem.difficulty,
      statement: plainText(problem.descriptionMd),
      tags: problem.topicTags.map(leetcodeTagName),
      techniques: catalogTechniques(problem.slug, language),
      notes: problem.notes,
    },
    accepted,
  });
  const markdown = serializeSolutions(approaches, language);
  const updated = await db
    .update(schema.problems)
    .set({ solutionsMd: markdown, solutionsVersion: problem.solutionsVersion + 1, updatedAt: new Date() })
    .where(
      and(
        eq(schema.problems.id, args.problemId),
        eq(schema.problems.userId, args.userId),
        eq(schema.problems.solutionsVersion, problem.solutionsVersion),
      ),
    )
    .returning({ id: schema.problems.id });
  if (updated.length === 0) {
    // Written meanwhile (another tab, or the user): use that one.
    const [current] = await db
      .select({ solutionsMd: schema.problems.solutionsMd })
      .from(schema.problems)
      .where(and(eq(schema.problems.id, args.problemId), eq(schema.problems.userId, args.userId)))
      .limit(1);
    return parseSolutions(current?.solutionsMd).approaches;
  }
  return parseSolutions(markdown).approaches;
}

/** The techniques 灵茶山艾府's catalog files a problem under, named in the
 *  doc's language (his "Other …" leftovers name no technique). Hints for the
 *  writer, not headings. */
export function catalogTechniques(slug: string, language: "en" | "zh"): string[] {
  const names = patternsForSlug(slug)
    .filter(({ pattern }) => !isMiscPattern(pattern))
    .map(({ topic, pattern }) =>
      language === "zh"
        ? `${pattern.zh.split(" / ").at(-1) ?? pattern.zh}（${topic.zh}）`
        : `${pattern.en} (${topic.en})`,
    );
  return [...new Set(names)];
}

/** Writes the approaches for one problem (no saving). */
export async function generateSolutions(args: {
  model: LanguageModel;
  settings: AiRuntimeSettings;
  abortSignal?: AbortSignal;
  language: "en" | "zh";
  problem: {
    title: string;
    difficulty: string;
    statement: string;
    tags: string[];
    /** From catalogTechniques(); may be empty. */
    techniques?: string[];
    notes: string | null;
  };
  accepted: { code: string; language: string }[];
}): Promise<{ name: string; mine: boolean; signal: string; points: string[]; complexity: string }[]> {
  const { problem, accepted } = args;
  const language = args.language === "zh" ? "Simplified Chinese" : "English";
  const techniques = problem.techniques ?? [];

  const prompt = [
    `# Problem: ${problem.title} (${problem.difficulty})`,
    `Topics: ${problem.tags.join(", ") || "none"}`,
    ...(techniques.length
      ? [
          "",
          "## Techniques a problem catalog files it under (hints, not headings)",
          ...techniques.map((technique) => `- ${technique}`),
        ]
      : []),
    "",
    "## Statement",
    clip(problem.statement, STATEMENT_MAX) || "(not captured; use what you know about this LeetCode problem)",
    "",
    "## The learner's Notes",
    clip(problem.notes, NOTES_MAX) || "(empty)",
    "",
    "## The learner's Accepted submissions, newest first",
    accepted.length
      ? accepted.map((submission) => `\`\`\`${submission.language}\n${clip(submission.code, CODE_MAX)}\n\`\`\``).join("\n\n")
      : "(none)",
    "",
    "Return the JSON object now.",
  ].join("\n");

  const attempt = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const abort = () => controller.abort();
    args.abortSignal?.addEventListener("abort", abort, { once: true });
    try {
      const { output } = await generateText({
        model: args.model,
        output: Output.object({ schema: solutionsSchema }),
        system: `You write the reference a learner's spoken review of one LeetCode problem is checked against. The learner will say which technique the problem calls for and what in the statement points to it, then explain, in their own words, how they'd solve it; each point you write is checked as said or not said. A point that's too specific fails learners who clearly know the solution.

Return one JSON object of this shape and nothing else:
{"approaches": [{"name": "...", "mine": true, "signal": "...", "points": ["...", "..."], "complexity": "..."}]}

- First approach: the one in the learner's Accepted code (mine: true). If they have no Accepted submission, mine is false everywhere.
- Then at most 2 genuinely different approaches that pass the constraints. Variants of one algorithm that differ only in details (boundary conventions, iterative vs recursive, a library container) are the same approach: don't list them separately. Leave out brute force that would time out. One approach is fine.
- name: the technique, 2 to 6 words, the way people usually call it, e.g. "Variable-size sliding window", "Bottom-up DP", "One-pass hash map". If the prompt lists techniques from a catalog, use them as hints for naming an approach that uses one, in your own words; they aren't headings to copy, and an approach that fits none of them is fine.
- signal: what in the problem statement points to this technique, as one short phrase of 1 to 3 features a reader should notice, e.g. "contiguous subarray, all values positive, sum ≥ target". Only features of the statement (the input and its constraints, what's asked), never the technique's name or the algorithm's steps. If one feature is what makes this technique work rather than a similar one, include it (all values positive is what lets a window shrink safely). Don't add a label like "Signal:".
- points: 2 to 4 per approach (5 only for a genuinely intricate one), each one idea in one plain sentence, not repeating the signal:
  1. The first point is the core idea, the thing that makes the approach work, the way someone would say it out loud ("compare with the middle element and throw away the half that can't hold the target").
  2. Then what is tracked or defined, the order or transition, and the one case that's easy to get wrong, if there is one.
  Say ideas, not syntax: no code expressions or exact loop conditions unless that specific formula is itself the insight. Leave out what any working solution does anyway (returning the result or -1, output order, inputs the problem guarantees, naming), details of one programming language (falsy checks, integer types, library calls), and implementation advice (recursion depth, sentinel nodes): those belong in Notes. Someone who explains the approach well should naturally say every point.
- complexity: time and space, e.g. "O(n) time, O(1) space".
- Write names, signals, and points in ${language}. Keep code identifiers and complexity notation as they are.`,
        prompt,
        // Capped at "low": quality holds up, and it fits within the turn.
        ...aiCallOptions(args.settings, "capped"),
        abortSignal: controller.signal,
      });
      return output;
    } finally {
      clearTimeout(timer);
      args.abortSignal?.removeEventListener("abort", abort);
    }
  };
  let output: z.infer<typeof solutionsSchema>;
  try {
    output = await attempt();
  } catch (error) {
    // Without native structured output the JSON sometimes doesn't fit; one
    // more try is cheaper than a practice without a reference.
    if (!NoObjectGeneratedError.isInstance(error)) throw error;
    output = await attempt();
  }

  return output.approaches.slice(0, MAX_APPROACHES).map((approach, index) => ({
    ...approach,
    // The signal goes first (serializeSolutions labels it); one repeated
    // among the points would be checked twice.
    points: approach.points.filter((point) => !isSignalPoint(point)).slice(0, MAX_POINTS),
    // Only the first can be theirs, and only with an Accepted submission.
    mine: approach.mine && index === 0 && accepted.length > 0,
  }));
}

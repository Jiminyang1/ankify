import { generateText, Output } from "ai";
import { and, desc, eq } from "drizzle-orm";
import { cardDraftSchema, type CardDraft } from "@ankify/contracts";
import { getDb, schema } from "@ankify/db";
import { getActiveModel } from "@/server/ai";
import { buildAiCardDraftPrompt } from "@/server/card-prompt";
import { getGenerationSettings } from "@/server/settings";

const AI_CARD_GENERATION_TIMEOUT_MS = 175_000;

async function loadCardPromptContext(userId: string, problemId: string) {
  const db = getDb();
  const [problem] = await db
    .select()
    .from(schema.problems)
    .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, userId)));
  if (!problem) throw new Error("problem_not_found");

  const submissions = await db
    .select()
    .from(schema.submissions)
    .where(and(eq(schema.submissions.userId, userId), eq(schema.submissions.problemId, problemId)))
    .orderBy(desc(schema.submissions.submittedAt))
    .limit(10);
  return { problem, submissions };
}

export async function generateAiCardDraft(args: {
  problemId: string;
  userId: string;
  action: "generate" | "followup";
  rawText?: string;
  draft?: CardDraft;
  instruction?: string;
}): Promise<CardDraft> {
  const tag = `[ai-card ${args.problemId}]`;
  const t0 = Date.now();
  const [{ problem, submissions }, { model, settings }, generation] = await Promise.all([
    loadCardPromptContext(args.userId, args.problemId),
    getActiveModel(args.userId),
    getGenerationSettings(args.userId),
  ]);
  const usesDeepSeekThinking = settings.provider === "deepseek" && settings.reasoningMode === "thinking";
  const prompt = buildAiCardDraftPrompt({
    problem,
    submissions,
    action: args.action,
    rawText: args.rawText,
    draft: args.draft,
    instruction: args.instruction,
    generationLanguage: generation.language,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_CARD_GENERATION_TIMEOUT_MS);
  try {
    const { output } = await generateText({
      model,
      output: Output.object({ schema: cardDraftSchema }),
      system: prompt.system,
      prompt: prompt.user,
      ...(!usesDeepSeekThinking ? { temperature: 0.35 } : {}),
      abortSignal: controller.signal,
    });
    console.log(`${tag} ${args.action} generated in ${Date.now() - t0}ms`);
    return output;
  } finally {
    clearTimeout(timer);
  }
}

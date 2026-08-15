import { generateText, type LanguageModel } from "ai";
import {
  buildSessionSummaryPrompt,
  SESSION_SUMMARY_INSTRUCTIONS,
} from "./prompt";
import {
  getAgentCompactionBatch,
  saveAgentSessionSummary,
} from "./store";

const SUMMARY_MAX_OUTPUT_TOKENS = 1_200;

export async function compactAgentSessionIfNeeded(args: {
  userId: string;
  sessionId: string;
  model: LanguageModel;
  abortSignal: AbortSignal;
}) {
  const batch = await getAgentCompactionBatch(args.userId, args.sessionId);
  if (!batch) return null;

  const result = await generateText({
    model: args.model,
    instructions: SESSION_SUMMARY_INSTRUCTIONS,
    prompt: buildSessionSummaryPrompt(batch.previousSummary, batch.turns),
    maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
    abortSignal: args.abortSignal,
  });
  return saveAgentSessionSummary({
    userId: args.userId,
    sessionId: args.sessionId,
    previousSummarizedRunCount: batch.summarizedRunCount,
    summarizedTurnCount: batch.turns.length,
    summary: result.text.trim(),
  });
}
